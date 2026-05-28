import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Search,
  Loader2,
  X,
  Compass,
  AlertCircle,
  Info,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Building2,
  MapPin,
  Sparkles,
  GraduationCap,
  BookOpen,
  Database,
  Target,
  Lightbulb,
  Briefcase,
  Layers,
  ListChecks,
} from "lucide-react";
import {
  supabase,
  type EscoSearchResult,
  type Industry,
  type CareerExplorerPayload,
  type CompetencyItem,
  type DemandComponent,
  type IndustryNationalSignal,
  type RegionSignal,
  type NearbyOccupation,
  type OpportunityMatrixItem,
  type EmployerDemand,
  type EmployerDemandSignal,
  type MarketOverviewPayload,
  type EmployerNeedItem,
  type IndustrySkillSignalsPayload,
  type DataSource,
  mergeDataSources,
  resolveDataSourceHeading,
  resolveDataSourceBody,
  shouldRenderDataSource,
  FALLBACK_DATA_SOURCES,
} from "@/lib/market";
import {
  resolveSalaryIndustry,
  industryNamesMatch,
  SALARY_PROFILE_SOURCES,
} from "@/lib/market/salaryProfile";
import { dedupeNeeds, matchesNeedSignal } from "@/lib/market/marketOverview";
import { SectionTabs, type SectionTabItem } from "@/components/market/SectionTabs";
import { Header } from "@/components/landing/Header";
import { PageHero } from "@/components/landing/PageHero";
import { REGIONS, cleanRegionLabel, regionLabelFromCode } from "@/lib/market/regions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  MarketOverview,
  MarketOverviewSkeleton,
  MarketOverviewError,
  DetailDrawer,
  FindOutSection as MarketFindOutSection,
  OccupationMarketCapacitySection,
  type DetailPayload,
  type MarketOverviewHandlers,
} from "@/components/market/MarketOverview";


type Mode = "compass" | "skills";

type Submitted = {
  searchText: string;
  displayTitle: string;
  occupationUri: string | null;
  regionCode: string | null;
  industrySlug: string | null;
};

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function bestTitle(r: EscoSearchResult): string {
  return r.title_no ?? r.title ?? r.title_en ?? r.uri;
}

function pct(n: number | string | null | undefined, digits = 1): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return "–";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} %`;
}

function num(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return "–";
  return new Intl.NumberFormat("nb-NO").format(Math.round(v));
}

function demandLevelLabel(level: string | undefined): string {
  switch (level) {
    case "high":
      return "Sterkt signal";
    case "medium":
      return "Moderat signal";
    case "low":
      return "Svakt signal";
    default:
      return "Ukjent signal";
  }
}

function levelToneClass(level: string | undefined): string {
  // Muted status dots — KarrierenMin status family, no vibrant fills.
  switch (level) {
    case "high":
      return "bg-[var(--km-success)]";
    case "medium":
      return "bg-[var(--km-warning)]";
    case "low":
      return "bg-[var(--km-danger)]";
    default:
      return "bg-[var(--km-ink-faint)]";
  }
}

// ===== Signal helpers (values 0-100) =====

type SignalTone = "strong" | "moderate" | "weak" | "missing";

function signalTone(v: number | null | undefined): SignalTone {
  if (v == null || Number.isNaN(v)) return "missing";
  if (v >= 70) return "strong";
  if (v >= 40) return "moderate";
  if (v > 0) return "weak";
  return "missing";
}

function signalToneLabel(t: SignalTone): string {
  switch (t) {
    case "strong":
      return "Sterkt signal";
    case "moderate":
      return "Moderat signal";
    case "weak":
      return "Svakt signal";
    default:
      return "Ikke nok data";
  }
}

/**
 * KarrierenMin tone map.
 * Brand v1.0: borders are rule, kort er bg-white, chips bruker
 * dempede success/warning/danger varianter. Ingen vibrante
 * seksjonsfarger, ingen venstre fargestriper.
 *
 * Beholder de gamle nøklene (emerald/amber/sky/indigo/teal/muted)
 * som API for å unngå storkall-refaktor, men alle peker nå på
 * rolige KM-varianter.
 */
const TONE = {
  emerald: {
    stripe: "",
    chip: "km-chip km-chip-success",
    iconBg: "bg-[var(--km-paper-warm)] text-[var(--km-ink)]",
    bar: "bg-[var(--km-success)]",
  },
  amber: {
    stripe: "",
    chip: "km-chip km-chip-warning",
    iconBg: "bg-[var(--km-paper-warm)] text-[var(--km-ink)]",
    bar: "bg-[var(--km-warning)]",
  },
  sky: {
    stripe: "",
    chip: "km-chip",
    iconBg: "bg-[var(--km-paper-warm)] text-[var(--km-ink)]",
    bar: "bg-[var(--km-ink-soft)]",
  },
  indigo: {
    stripe: "",
    chip: "km-chip",
    iconBg: "bg-[var(--km-paper-warm)] text-[var(--km-ink)]",
    bar: "bg-[var(--km-ink-soft)]",
  },
  teal: {
    stripe: "",
    chip: "km-chip",
    iconBg: "bg-[var(--km-paper-warm)] text-[var(--km-ink)]",
    bar: "bg-[var(--km-ink-soft)]",
  },
  muted: {
    stripe: "",
    chip: "km-chip",
    iconBg: "bg-[var(--km-paper-warm)] text-[var(--km-ink-soft)]",
    bar: "bg-[var(--km-ink-faint)]",
  },
} as const;

type ToneKey = keyof typeof TONE;

function toneForSignal(t: SignalTone): ToneKey {
  if (t === "strong") return "emerald";   // → success chip
  if (t === "moderate") return "amber";   // → warning chip
  if (t === "weak") return "muted";
  return "muted";
}

function quadrantTone(_q?: string | null): ToneKey {
  // KM: ingen seksjonsfarge per kvadrant. Hold nøytral.
  return "muted";
}

// ============================================================
// Aktiv-kontekst-helpers og normalisering
// ============================================================

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeLabel(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function slugifyName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[,\s\-_/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeTitleKey(s: string | null | undefined): string {
  return normalizeLabel(s).replace(/[.,;:!?()]/g, "").trim();
}

function isActiveRegion(
  item: { region_code?: string | null; region_label?: string | null },
  selectedRegionCode: string | null,
  selectedRegionLabel: string | null,
): boolean {
  if (!selectedRegionCode && !selectedRegionLabel) return false;
  if (
    selectedRegionCode &&
    item.region_code &&
    item.region_code === selectedRegionCode
  ) {
    return true;
  }
  const itemLabel = normalizeLabel(cleanRegionLabel(item.region_label ?? ""));
  const selLabel = normalizeLabel(cleanRegionLabel(selectedRegionLabel ?? ""));
  if (itemLabel && selLabel && itemLabel === selLabel) return true;
  // Spesialregel: Oslo som by/fylke kan ha ulike kodevarianter.
  if (itemLabel === "oslo" && selLabel === "oslo") return true;
  return false;
}

function isActiveIndustry(
  item: { slug?: string | null; name?: string | null; name_no?: string | null; title?: string | null },
  selectedIndustrySlug: string | null,
  selectedIndustryName?: string | null,
): boolean {
  if (!selectedIndustrySlug && !selectedIndustryName) return false;
  if (selectedIndustrySlug && item.slug && item.slug === selectedIndustrySlug) return true;
  const itemName = item.name ?? item.name_no ?? item.title ?? null;
  if (selectedIndustryName && industryNamesMatch(itemName, selectedIndustryName)) return true;
  if (selectedIndustrySlug && industryNamesMatch(itemName, selectedIndustrySlug)) return true;
  if (selectedIndustrySlug && item.name && slugifyName(item.name) === selectedIndustrySlug) return true;
  return false;
}

function isActiveOccupation(
  item: {
    occupation_uri?: string | null;
    title?: string | null;
    occupation_title?: string | null;
    label?: string | null;
  },
  selectedOccupationUri: string | null,
  selectedDisplayTitle: string | null,
): boolean {
  if (
    selectedOccupationUri &&
    item.occupation_uri &&
    item.occupation_uri === selectedOccupationUri
  ) {
    return true;
  }
  if (selectedDisplayTitle) {
    const sel = normalizeTitleKey(selectedDisplayTitle);
    if (sel) {
      const candidates = [item.title, item.occupation_title, item.label]
        .map((c) => normalizeTitleKey(c))
        .filter(Boolean);
      if (candidates.some((c) => c === sel)) return true;
    }
  }
  return false;
}

// ============================================================
// formatOccupationTitle
// ============================================================

const TITLE_ACRONYMS = new Set([
  "HR", "HMS", "IKT", "IT", "KI", "AI", "NAV", "SSB", "STYRK", "ESCO",
  "NHO", "EU", "VVS", "CNC",
]);

function looksAlreadyNatural(s: string): boolean {
  // Hvis ingen ord (3+ tegn) er ALL CAPS Title Case og det finnes lower-case
  // bokstaver i andre posisjoner enn første, regn som naturlig.
  const words = s.split(/\s+/).filter((w) => w.length >= 3 && /^[A-ZÆØÅ]/.test(w));
  if (words.length === 0) return true;
  const titleCount = words.filter((w) => /^[A-ZÆØÅ][a-zæøå]/.test(w)).length;
  // "Title Case Av Alt": de fleste ord starter med stor + følges av små.
  return titleCount <= 1;
}

function restoreAcronyms(word: string): string {
  // Sjekk hver "del" splittet på bindestrek
  return word
    .split("-")
    .map((part) => {
      const up = part.toUpperCase();
      if (TITLE_ACRONYMS.has(up)) return up;
      return part;
    })
    .join("-");
}

export function formatOccupationTitle(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";
  if (looksAlreadyNatural(raw)) {
    // Likevel sikre at akronymer i hvitelisten er korrekt cased.
    return raw
      .split(/\s+/)
      .map((w) => restoreAcronyms(w))
      .join(" ");
  }
  // Title-case-mønster: bygg om til sentence case.
  const parts = raw.split(",").map((seg) => seg.trim()).filter(Boolean);
  const sentenced = parts.map((seg, segIdx) => {
    const words = seg.split(/\s+/).map((w, wIdx) => {
      // Bevar ord som inneholder tall eller bindestrek hvis de allerede ser riktige ut.
      if (/[0-9]/.test(w)) return restoreAcronyms(w);
      if (w.includes("-")) return restoreAcronyms(w);
      const lower = w.toLowerCase();
      if (segIdx === 0 && wIdx === 0) {
        return restoreAcronyms(lower.charAt(0).toUpperCase() + lower.slice(1));
      }
      return restoreAcronyms(lower);
    });
    return words.join(" ");
  });
  return sentenced.join(", ");
}


// ============================================================
// Main component
// ============================================================

export function CareerExplorer() {
  const [mode, setMode] = useState<Mode>("compass");
  const [industrySlug, setIndustrySlug] = useState<string | null>(null);
  const [regionCode, setRegionCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EscoSearchResult | null>(null);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const regionTriggerRef = useRef<HTMLButtonElement>(null);
  const industryTriggerRef = useRef<HTMLButtonElement>(null);
  const overviewTopRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounced(query, 200);

  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [selectedDemandSignal, setSelectedDemandSignal] =
    useState<EmployerNeedItem | null>(null);

  function focusRegion() {
    const el = regionTriggerRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => el.focus(), 350);
  }

  function focusIndustry() {
    const el = industryTriggerRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => el.focus(), 350);
  }

  function focusSearchInput() {
    const el = inputRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      el.focus();
      el.select();
    }, 350);
  }

  function scrollToOverview() {
    setTimeout(() => {
      overviewTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function pickIndustry(slug: string) {
    setIndustrySlug(slug);
    setSubmitted(null);
    scrollToOverview();
  }

  function pickRegion(code: string) {
    setRegionCode(code);
    setSubmitted(null);
    scrollToOverview();
  }

  function clearIndustry() {
    setIndustrySlug(null);
    setSubmitted(null);
    scrollToOverview();
  }

  function clearRegion() {
    setRegionCode(null);
    setSubmitted(null);
    scrollToOverview();
  }

  function openCareerDirection(p: { occupation_uri: string; title: string }) {
    setQuery(p.title);
    setSelected(null);
    setAutocompleteOpen(false);
    setSubmitted({
      searchText: p.occupation_uri || p.title,
      displayTitle: p.title,
      occupationUri: p.occupation_uri || null,
      regionCode,
      industrySlug,
    });
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  }

  function openDetail(d: DetailPayload) {
    setDetail(d);
  }

  function pickDemandSignal(n: EmployerNeedItem) {
    setSelectedDemandSignal(n);
    setDetail(null);
    setSubmitted(null);
    scrollToOverview();
  }

  function clearDemandSignal() {
    setSelectedDemandSignal(null);
  }

  function scrollToCareers() {
    document.getElementById("karriereretninger")?.scrollIntoView({ behavior: "smooth" });
  }

  function searchOccupation(title: string) {
    if (!title || title.trim().length < 2) return;
    setQuery(title);
    setSelected(null);
    setAutocompleteOpen(false);
    setSelectedDemandSignal(null);
    setSubmitted({
      searchText: title,
      displayTitle: title,
      occupationUri: null,
      regionCode,
      industrySlug,
    });
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  const overviewHandlers: MarketOverviewHandlers = {
    onPickIndustry: pickIndustry,
    onPickRegion: pickRegion,
    onClearIndustry: clearIndustry,
    onClearRegion: clearRegion,
    onOpenCareerDirection: openCareerDirection,
    onOpenDetail: openDetail,
    onFocusRegion: focusRegion,
    onFocusIndustry: focusIndustry,
    onFocusSearch: focusSearchInput,
    onPickDemandSignal: pickDemandSignal,
    onClearDemandSignal: clearDemandSignal,
    onSearchOccupation: searchOccupation,
  };



  // ----- Industries -----
  const industriesQuery = useQuery({
    queryKey: ["industries"],
    queryFn: async (): Promise<Industry[]> => {
      const primary = await supabase
        .from("industries")
        .select("slug, name_no, sort_order")
        .order("sort_order", { ascending: true })
        .order("name_no", { ascending: true });
      if (!primary.error && primary.data) return primary.data as Industry[];

      console.error("industries primary order failed, falling back", primary.error);
      const fallback = await supabase
        .from("industries")
        .select("slug, name_no")
        .order("name_no", { ascending: true });
      if (fallback.error) {
        console.error("industries fallback failed", fallback.error);
        throw new Error("Kunne ikke laste bransjer.");
      }
      return fallback.data as Industry[];
    },
  });

  // ----- Autocomplete -----
  const autocompleteQuery = useQuery({
    queryKey: ["esco-search", debouncedQuery, industrySlug],
    enabled: debouncedQuery.trim().length >= 2 && autocompleteOpen,
    queryFn: async (): Promise<EscoSearchResult[]> => {
      const { data, error } = await supabase.rpc("search_esco_occupations", {
        search_text: debouncedQuery,
        filter_industry_slugs: industrySlug ? [industrySlug] : null,
        result_limit: 8,
      });
      if (error) {
        console.error("search_esco_occupations error", error);
        throw new Error("Prøv igjen om litt.");
      }
      return (data ?? []) as EscoSearchResult[];
    },
  });

  // ----- Main payload -----
  const explorerQuery = useQuery({
    queryKey: [
      "career-explorer",
      submitted?.searchText,
      submitted?.regionCode,
      submitted?.industrySlug,
    ],
    enabled: !!submitted,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<CareerExplorerPayload> => {
      if (!submitted) throw new Error("no submission");
      const { data, error } = await supabase.rpc("get_career_direction_explorer", {
        search_text: submitted.searchText,
        filter_region_code: submitted.regionCode,
        filter_industry_slug: submitted.industrySlug,
      });
      if (error) {
        console.error("get_career_direction_explorer error", error);
        throw new Error("Kunne ikke hente resultater. Prøv igjen.");
      }
      return data as CareerExplorerPayload;
    },
  });

  // ----- Public market overview (landing) -----
  const overviewQuery = useQuery({
    queryKey: ["market-overview", regionCode, industrySlug],
    enabled: !submitted,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MarketOverviewPayload> => {
      const { data, error } = await supabase.rpc("get_public_market_overview", {
        filter_region_code: regionCode,
        filter_industry_slug: industrySlug,
      });
      if (error) {
        console.error("get_public_market_overview error", error);
        throw new Error("Kunne ikke hente markedsbildet.");
      }
      return (data ?? {}) as MarketOverviewPayload;
    },
  });

  // ----- Industry/region skill signals (ESCO/STYRK requirements) -----
  const skillSignalsQuery = useQuery({
    queryKey: ["industry-skill-signals", regionCode, industrySlug],
    enabled: !submitted,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<IndustrySkillSignalsPayload> => {
      const { data, error } = await supabase.rpc("get_industry_skill_signals", {
        filter_industry_slug: industrySlug,
        filter_region_code: regionCode,
        result_limit: 24,
      });
      if (error) {
        console.error("get_industry_skill_signals error", error);
        throw new Error("Kunne ikke hente kompetansekrav.");
      }
      return (data ?? {}) as IndustrySkillSignalsPayload;
    },
  });

  // Reconcile selectedDemandSignal when overview payload changes.
  // Match on type + normalized label only; do NOT swap in a generic fallback.
  useEffect(() => {
    if (!selectedDemandSignal || !overviewQuery.data) return;
    const needs = overviewQuery.data.employer_needs ?? {};
    const pool = dedupeNeeds(
      [
        ...(needs.competence_fields ?? []),
        ...(needs.education_levels ?? []),
        ...(needs.signals ?? []),
      ],
      { regionCode, industrySlug },
    );
    const match = pool.find((n) => matchesNeedSignal(n, selectedDemandSignal));
    if (match && match !== selectedDemandSignal) {
      setSelectedDemandSignal(match);
    }
    // If not found we keep the existing object; focus block renders
    // "ikke tydelig i valgt utvalg".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewQuery.data, regionCode, industrySlug]);


  const canSubmit =
    query.trim().length >= 2 && !explorerQuery.isFetching;

  function runSearch(opts?: { suggestion?: EscoSearchResult; title?: string }) {
    const sug = opts?.suggestion ?? selected;
    const title = opts?.title ?? (sug ? bestTitle(sug) : query.trim());
    if (!title || title.length < 2) return;
    setAutocompleteOpen(false);
    setSelectedDemandSignal(null);
    setSubmitted({
      // Use URI internally if available, otherwise use the visible title.
      searchText: sug?.uri ?? title,
      displayTitle: title,
      occupationUri: sug?.uri ?? null,
      regionCode,
      industrySlug,
    });
  }


  function pickSuggestion(r: EscoSearchResult) {
    const title = bestTitle(r);
    setSelected(r);
    setQuery(title);
    setAutocompleteOpen(false);
    runSearch({ suggestion: r, title });
  }

  const filtersDiffer =
    !!submitted &&
    (submitted.regionCode !== regionCode || submitted.industrySlug !== industrySlug);

  return (
    <div className="min-h-screen bg-[var(--km-paper)]">
      <Header />
      <PageHero
        eyebrow="MARKEDSINNSIKT"
        title={
          <>
            Utforsk jobbkompetanse og <span className="text-[var(--km-blue)]">karriereveier</span>
          </>
        }
        lead="Undersøk en stilling, et yrke, en kompetanse, en bransje eller et område. Utforsk markedssignaler, relevante bransjer, nærliggende karriereveier og etterspurt kompetanse. Se hva du kan forvente å tjene i det valgte yrket. Se hvilke yrker det er et overskudd på i markedet og hvilke er det stort behov for. Siden oppdaterer seg dynamisk og snevrer seg inn etterhvert som du filtrerer og velger. "
      />

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-10">
        <section className="space-y-6">


          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="compass" className="gap-1.5">
                <Compass className="h-4 w-4" /> Karrierekompass
              </TabsTrigger>
              <TabsTrigger value="skills" className="gap-1.5">
                <Sparkles className="h-4 w-4" /> Kompetansekrav
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Filters & search */}
          <div className="rounded-xl border bg-card p-4 md:p-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <FieldLabel label="Bransje">
                <Select
                  value={industrySlug ?? "__all"}
                  onValueChange={(v) => setIndustrySlug(v === "__all" ? null : v)}
                >
                  <SelectTrigger ref={industryTriggerRef} className="h-10">
                    <SelectValue placeholder="Alle bransjer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Alle bransjer</SelectItem>
                    {(industriesQuery.data ?? []).map((i) => (
                      <SelectItem key={i.slug} value={i.slug}>
                        {i.name_no}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldLabel>

              <FieldLabel label="Område">
                <Select
                  value={regionCode ?? "__all"}
                  onValueChange={(v) => setRegionCode(v === "__all" ? null : v)}
                >
                  <SelectTrigger ref={regionTriggerRef} className="h-10">
                    <SelectValue placeholder="Hele Norge" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Hele Norge</SelectItem>
                    {REGIONS.filter((r) => r.value !== null).map((r) => (
                      <SelectItem key={r.value as string} value={r.value as string}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldLabel>
            </div>

            <FieldLabel label="Søk etter stilling eller yrke">
              <div className="flex flex-col md:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelected(null);
                      setAutocompleteOpen(true);
                    }}
                    onFocus={() => setAutocompleteOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runSearch();
                      } else if (e.key === "Escape") {
                        setAutocompleteOpen(false);
                      }
                    }}
                    placeholder="F.eks. sykepleier, programvareutvikler, elektriker..."
                    className="pl-9 pr-9 h-10"
                    autoComplete="off"
                  />
                  {query && (
                    <button
                      onClick={() => {
                        setQuery("");
                        setSelected(null);
                        inputRef.current?.focus();
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
                      aria-label="Tøm søk"
                      type="button"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {autocompleteOpen && debouncedQuery.trim().length >= 2 && (
                    <AutocompletePopover
                      loading={autocompleteQuery.isFetching}
                      error={autocompleteQuery.error as Error | null}
                      results={autocompleteQuery.data ?? []}
                      onPick={pickSuggestion}
                      onClose={() => setAutocompleteOpen(false)}
                    />
                  )}
                </div>

                <Button
                  size="lg"
                  className="h-10 md:w-auto"
                  disabled={!canSubmit}
                  onClick={() => runSearch()}
                >
                  {explorerQuery.isFetching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Søker...
                    </>
                  ) : mode === "compass" ? (
                    <>
                      Utforsk karriereretning <ArrowRight className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Se kompetansekrav <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </FieldLabel>

            {filtersDiffer && !explorerQuery.isFetching && (
              <div className="flex items-start gap-2 rounded-md border border-rule bg-[var(--km-paper-warm)] px-3 py-2 text-xs text-[var(--km-ink-soft)]">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Resultatene under gjelder forrige søk. Trykk knappen igjen for å
                  hente resultater med nye filtre.
                </span>
              </div>
            )}
          </div>

          {/* Sticky seksjonsnavigasjon */}
          {(() => {
            const activePayload = submitted
              ? explorerQuery.data ?? null
              : overviewQuery.data ?? null;
            if (!activePayload) return null;
            const items = buildSectionTabItems({
              submitted: !!submitted,
              payload: activePayload,
              industrySlug,
            });
            if (items.length === 0) return null;
            return <SectionTabs items={items} />;
          })()}

          {/* Result area */}
          <div ref={overviewTopRef} className="min-h-[200px] scroll-mt-24">
            {!submitted && overviewQuery.isLoading && !overviewQuery.data && (
              <MarketOverviewSkeleton />
            )}
            {!submitted && overviewQuery.error && !overviewQuery.data && (
              <MarketOverviewError onRetry={() => overviewQuery.refetch()} />
            )}
            {!submitted && overviewQuery.data && (
              <MarketOverview
                payload={overviewQuery.data}
                filters={{ regionCode, industrySlug }}
                handlers={overviewHandlers}
                isRefreshing={overviewQuery.isFetching}
                selectedDemandSignal={selectedDemandSignal}
                skillSignals={skillSignalsQuery.data ?? null}
                skillSignalsLoading={skillSignalsQuery.isFetching}
              />
            )}
            {submitted && explorerQuery.isLoading && <ResultSkeleton />}
            {submitted && explorerQuery.error && (
              <ResultError
                message={(explorerQuery.error as Error).message}
                onRetry={() => explorerQuery.refetch()}
              />
            )}
            {submitted && explorerQuery.data && (
              <Result
                payload={explorerQuery.data}
                mode={mode}
                submitted={submitted}
                onFocusRegion={focusRegion}
                onFocusSearch={focusSearchInput}
              />
            )}
          </div>
        </section>

        {/* Landing sections */}
        <MarketFindOutSection handlers={overviewHandlers} />
        <DataSourcesSection
          sources={mergeDataSources(
            overviewQuery.data?.data_sources as DataSource[] | undefined,
            explorerQuery.data?.data_sources as DataSource[] | undefined,
            (() => {
              const explorerIndustries = explorerQuery.data?.industries ?? null;
              const salary = resolveSalaryIndustry({
                filterSlug: industrySlug,
                payload: {
                  summary: overviewQuery.data?.summary,
                  industries: explorerIndustries,
                  industry_trends: overviewQuery.data?.industry_trends,
                },
                knownIndustries: explorerIndustries?.matches ?? null,
              });
              return salary.source !== "none" ? SALARY_PROFILE_SOURCES : [];
            })(),
          )}
        />
        <HowToUseSection />
      </main>

      <DetailDrawer
        detail={detail}
        onClose={() => setDetail(null)}
        onPickIndustry={pickIndustry}
        onPickRegion={pickRegion}
        onScrollToCareers={scrollToCareers}
      />

      <SiteFooter />
    </div>

  );
}

// ============================================================
// Section tabs items
// ============================================================

function buildSectionTabItems(input: {
  submitted: boolean;
  payload: CareerExplorerPayload | MarketOverviewPayload | null;
  industrySlug: string | null;
}): SectionTabItem[] {
  const { submitted, payload, industrySlug } = input;
  if (!payload) return [];

  // Defensive payload reads.
  const p = payload as Partial<CareerExplorerPayload> &
    Partial<MarketOverviewPayload> & Record<string, unknown>;
  const industries = (p.industries ?? null) as
    | { matches?: Array<unknown>; national_signals?: Array<unknown> }
    | null;
  const nearby = (p.nearby_occupations ?? []) as Array<unknown>;

  const salary = resolveSalaryIndustry({
    filterSlug: industrySlug,
    payload: {
      summary: (p.summary ?? null) as never,
      industries: industries as never,
      industry_trends: (p.industry_trends ?? null) as never,
    },
    knownIndustries: (industries?.matches ?? null) as never,
  });
  const hasSalary = salary.source !== "none";

  if (submitted) {
    // Yrkesdetalj (CompassView)
    const items: SectionTabItem[] = [
      { id: "oversikt", label: "Oversikt" },
      { id: "arbeidsmarked", label: "Arbeidsmarkedet" },
    ];
    if (hasSalary) items.push({ id: "lonn", label: "Lønn" });
    items.push({ id: "omrade", label: "Regioner" });
    items.push({ id: "kompetanser", label: "Kompetanse" });
    if (nearby.length > 0)
      items.push({ id: "naerliggende", label: "Karriereveier" });
    items.push({ id: "datagrunnlag", label: "Datagrunnlag" });
    return items;
  }

  // Oversikt (MarketOverview)
  const items: SectionTabItem[] = [
    { id: "behov-fokus", label: "Arbeidsmarkedet" },
    { id: "karriereretninger", label: "Karriereretninger" },
    { id: "kompetanseomrader", label: "Kompetanse" },
  ];
  if (hasSalary) items.push({ id: "lonn", label: "Lønn" });
  items.push({ id: "datagrunnlag", label: "Datagrunnlag" });
  return items;
}


// ============================================================
// Layout primitives
// ============================================================
// (SiteHeader removed — Markedsinnsikt bruker felles <Header />
//  fra src/components/landing/Header.tsx)
// ============================================================


function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-card/40">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground flex flex-wrap gap-2 justify-between">
        <span>© karrierenmin.no</span>
        <span>
          Indikatorer basert på åpne datakilder. Ikke personlig
          karriererådgivning.
        </span>
      </div>
    </footer>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ============================================================
// Autocomplete
// ============================================================

function AutocompletePopover({
  loading,
  error,
  results,
  onPick,
  onClose,
}: {
  loading: boolean;
  error: Error | null;
  results: EscoSearchResult[];
  onPick: (r: EscoSearchResult) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={onClose}
        aria-hidden
      />
      <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover shadow-md overflow-hidden">
        {loading && results.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Søker...
          </div>
        ) : error ? (
          <div className="px-3 py-3 text-sm text-destructive">
            Kunne ikke søke. {error.message}
          </div>
        ) : results.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            Ingen forslag. Trykk knappen for å søke uansett.
          </div>
        ) : (
          <ul className="max-h-72 overflow-auto divide-y">
            {results.map((r) => (
              <li key={r.uri}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(r);
                  }}
                >
                  <div className="text-sm font-medium truncate">
                    {bestTitle(r)}
                  </div>
                  {r.industry_names && r.industry_names.length > 0 && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {r.industry_names.slice(0, 3).join(" • ")}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ============================================================
// Result states
// ============================================================

function InitialEmpty({ mode }: { mode: Mode }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/40 p-10 text-center">
      <Compass className="h-8 w-8 mx-auto mb-3 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        {mode === "compass"
          ? "Velg bransje og område, søk etter en stilling, og se markedssignaler, kompetanser og nærliggende karriereveier."
          : "Søk etter en stilling for å se må-ha-kompetanser og kompetanser som styrker profilen."}
      </p>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-6 animate-pulse space-y-3">
        <div className="h-6 w-1/2 bg-muted rounded" />
        <div className="h-4 w-3/4 bg-muted rounded" />
        <div className="h-2 w-full bg-muted rounded mt-4" />
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-5 h-32 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function ResultError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-6 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-start gap-3 flex-1">
        <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
        <div>
          <div className="font-medium">Kunne ikke hente resultater</div>
          <div className="text-sm text-muted-foreground">{message}</div>
        </div>
      </div>
      <Button variant="outline" onClick={onRetry}>
        Prøv igjen
      </Button>
    </div>
  );
}

function EmptyPayload({ payload }: { payload: CareerExplorerPayload }) {
  return (
    <div className="rounded-xl border bg-card p-8 text-center space-y-2">
      <Info className="h-6 w-6 mx-auto text-muted-foreground" />
      <h3 className="text-lg font-semibold">
        {payload.empty_state?.title ?? "Ingen treff"}
      </h3>
      {payload.message && (
        <p className="text-sm text-muted-foreground">{payload.message}</p>
      )}
      {payload.empty_state?.suggestion && (
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {payload.empty_state.suggestion}
        </p>
      )}
    </div>
  );
}

// ============================================================
// Result
// ============================================================

function Result({
  payload,
  mode,
  submitted,
  onFocusRegion,
  onFocusSearch,
}: {
  payload: CareerExplorerPayload;
  mode: Mode;
  submitted: Submitted;
  onFocusRegion: () => void;
  onFocusSearch: () => void;
}) {
  if (!payload.found) return <EmptyPayload payload={payload} />;

  // Genuine "no direction" check: only true if there is essentially nothing useful.
  if (isPayloadEmpty(payload)) {
    return <SoftEmptyResult payload={payload} />;
  }

  if (mode === "skills") return <SimpleSkillsView payload={payload} />;
  return (
    <CompassView
      payload={payload}
      submitted={submitted}
      onFocusRegion={onFocusRegion}
      onFocusSearch={onFocusSearch}
    />
  );
}

function isPayloadEmpty(p: CareerExplorerPayload): boolean {
  const noComponents = (p.demand?.components ?? []).length === 0;
  const noRegions = (p.geography?.regions ?? []).length === 0;
  const noIndustries =
    (p.industries?.matches ?? []).length === 0 &&
    (p.industries?.national_signals ?? []).length === 0;
  const noNearby = (p.nearby_occupations ?? []).length === 0;
  return noComponents && noRegions && noIndustries && noNearby;
}

function SoftEmptyResult({ payload }: { payload: CareerExplorerPayload }) {
  return (
    <div className="rounded-xl border bg-card p-8 space-y-3">
      <h3 className="text-lg font-semibold">Vi fant ingen tydelig retning</h3>
      <p className="text-sm text-muted-foreground">
        Vi har for lite datagrunnlag til å gi et godt bilde for{" "}
        <span className="font-medium text-foreground">
          {payload.summary?.title ?? payload.query}
        </span>
        . Prøv et bredere søk eller en annen kombinasjon av filtre.
      </p>
      <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
        <li>Prøv en bredere stillingstittel.</li>
        <li>Velg «Hele Norge» for å se nasjonalt bilde.</li>
        <li>Fjern bransjefilter.</li>
      </ul>
    </div>
  );
}

// ---------- Karrierekompass ----------

function CompassView({
  payload,
  submitted,
  onFocusRegion,
  onFocusSearch,
}: {
  payload: CareerExplorerPayload;
  submitted: Submitted;
  onFocusRegion: () => void;
  onFocusSearch: () => void;
}) {
  const opportunityItems =
    payload.opportunity_matrix?.items ??
    payload.visualization?.opportunity_matrix?.items ??
    null;

  const selectedRegionLabel = submitted.regionCode
    ? regionLabelFromCode(submitted.regionCode)
    : null;

  return (
    <div className="space-y-6">
      <section id="oversikt" className="scroll-mt-24 space-y-6">
        <SummaryCard payload={payload} />
        <DemandBreakdown components={payload.demand?.components ?? []} />
        <NeedsCompass employerDemand={payload.demand?.employer_demand} />
      </section>
      <CompassMarketAndSalary
        submitted={submitted}
        payload={payload}
      />
      <RegionSpotlight
        payload={payload}
        regionCode={submitted.regionCode}
        selectedRegionLabel={selectedRegionLabel}
        selectedOccupationUri={submitted.occupationUri}
        selectedDisplayTitle={submitted.displayTitle}
      />
      <section id="omrade" className="scroll-mt-24">
        <div className="grid gap-6 lg:grid-cols-2">
          <IndustriesSection
            industries={payload.industries}
            selectedIndustrySlug={submitted.industrySlug}
            selectedIndustryName={
              (payload.industries?.matches ?? []).find(
                (m) => m.slug === submitted.industrySlug,
              )?.name ?? null
            }
          />
          <RegionsSection
            regions={payload.geography?.regions ?? []}
            regionCode={submitted.regionCode}
            selectedRegionLabel={selectedRegionLabel}
          />
        </div>
      </section>
      <section id="kompetanser" className="scroll-mt-24">
        <CompetenciesSection competencies={payload.competencies} />
      </section>
      <OpportunityMatrix
        items={opportunityItems}
        fallback={payload.nearby_occupations ?? []}
        selectedOccupationUri={submitted.occupationUri}
        selectedDisplayTitle={submitted.displayTitle}
        selectedRegionCode={submitted.regionCode}
      />
      <section id="naerliggende" className="scroll-mt-24">
        <NearbySection
          nearby={payload.nearby_occupations ?? []}
          selectedOccupationUri={submitted.occupationUri}
          selectedDisplayTitle={submitted.displayTitle}
        />
      </section>
      <LearnNextSection competencies={payload.competencies} />
      <NextSteps
        onFocusRegion={onFocusRegion}
        onFocusSearch={onFocusSearch}
      />
    </div>
  );
}

function CompassMarketAndSalary({
  submitted,
  payload,
}: {
  submitted: Submitted;
  payload: CareerExplorerPayload;
}) {
  const industries = payload.industries ?? null;
  const filterName =
    (industries?.matches ?? []).find((m) => m.slug === submitted.industrySlug)?.name ??
    null;
  const salary = resolveSalaryIndustry({
    filterSlug: submitted.industrySlug,
    filterName,
    payload: { industries },
    knownIndustries: industries?.matches ?? null,
  });
  return (
    <OccupationMarketCapacitySection
      occupationUri={submitted.occupationUri}
      title={submitted.displayTitle}
      query={submitted.searchText}
      salaryIndustrySlug={salary.slug}
      salaryIndustryName={salary.name}
      salaryIndustrySource={salary.source}
    />
  );
}


function SummaryCard({ payload }: { payload: CareerExplorerPayload }) {
  const s = payload.summary;
  const score = s?.demand_score ?? payload.demand?.score ?? 0;
  const level = s?.demand_level ?? payload.demand?.level;
  const insights = s?.key_insights ?? [];

  return (
    <section className="rounded-xl border bg-card p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl md:text-2xl font-semibold">
            {formatOccupationTitle(s?.title ?? payload.query)}
          </h2>

          {s?.description && (
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              {s.description}
            </p>
          )}
        </div>
        {s?.primary_industry?.name && (
          <Badge variant="secondary" className="gap-1">
            <Building2 className="h-3 w-3" />
            {s.primary_industry.name}
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">
            Markedssignal · indikator (0–100)
          </span>
          <span className="font-mono tabular-nums text-sm">
            {score.toFixed(0)} <span className="text-muted-foreground">/ 100</span>
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full transition-all", levelToneClass(level))}
            style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <Badge variant="outline" className="gap-1.5">
            <span
              className={cn("h-1.5 w-1.5 rounded-full", levelToneClass(level))}
            />
            {demandLevelLabel(level)}
          </Badge>
          <span className="text-muted-foreground">
            Indikator, ikke prognose for enkeltpersoner.
          </span>
        </div>
      </div>

      <div className="rounded-md border bg-background/60 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
        <Database className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Bygger på åpne data fra Statistisk sentralbyrå, NHO
          Kompetansebarometeret og europeiske/norske yrkes- og kompetansedata.{" "}
          <a href="#datagrunnlag" className="underline hover:text-foreground">
            Les om datagrunnlaget
          </a>
          .
        </span>
      </div>

      {insights.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {insights.map((line, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>{humanizeInsight(stripRegionSuffixes(line))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Removes "Oslo - Oslove" style suffixes anywhere in an insight string. */
function stripRegionSuffixes(s: string): string {
  return s.replace(/ - [A-Za-zÆØÅæøå][^.,;:!?]*?(?=[.,;:!?\s]|$)/g, "");
}

/** Rewrites raw backend insight strings into plain Norwegian product language. */
function humanizeInsight(s: string): string {
  let out = s;

  // "Samlet signal er moderat signal (55.87 av 100) basert på SSB og relevante NHO-signaler."
  const overall = out.match(
    /Samlet signal er (sterkt|moderat|svakt) signal[^.]*\./i,
  );
  if (overall) {
    const lvl = overall[1].toLowerCase();
    out = out.replace(
      overall[0],
      `Markedssignalet er ${lvl}. Det bygger på sysselsettingsdata og arbeidsgiveres rapporterte kompetansebehov.`,
    );
  }

  // "Yrket har 30 nødvendige ESCO-kompetanser og 30 tilleggskompetanser i grunnlaget."
  out = out.replace(
    /Yrket har (\d+) nødvendige ESCO-kompetanser og (\d+) tilleggskompetanser[^.]*\./i,
    "Vi fant $1 typiske må-ha-kompetanser og $2 kompetanser som kan styrke profilen.",
  );

  // "Sterkeste regionale signal i resultatet er X."
  out = out.replace(
    /Sterkeste regionale signal i resultatet er ([^.]+)\./i,
    "Blant områdene i datagrunnlaget peker $1 tydeligst ut for denne retningen.",
  );

  // "Det finnes nærliggende yrker med opptil 106.19 prosent kompetanseoverlapp."
  out = out.replace(
    /Det finnes nærliggende yrker med opptil [\d.,]+\s*prosent kompetanseoverlapp\.?/i,
    "Det finnes nærliggende yrker med høy kompetanseoverlapp.",
  );

  // Generic cleanups
  out = out
    .replace(/ESCO-kompetanser/gi, "kompetanser knyttet til denne stillingen")
    .replace(/\bESCO\b/g, "yrkesdata")
    .replace(/STYRK-yrkesgruppe/gi, "yrkesgruppe")
    .replace(/\bSTYRK[- ]?08\b/gi, "norsk stillingsbetegnelse")
    .replace(/\bSTYRK\b/g, "norsk stillingsbetegnelse")
    .replace(/SSB\s*\d{4,6}/g, "Statistisk sentralbyrå")
    .replace(/\bmapping\b/gi, "kobling")
    .replace(/\(?[\d.,]+\s*av\s*100\)?/gi, "(signalverdi tilgjengelig)");

  return out;
}

/** Maps backend demand component to user-friendly labels & sources. */
function humanizeComponent(c: DemandComponent): {
  label: string;
  description: string;
  source: string;
} {
  const k = (c.key || "").toLowerCase();
  const lbl = (c.label || "").toLowerCase();

  if (k.includes("ssb") || lbl.includes("ssb") || lbl.includes("styrk") || lbl.includes("yrkesmarked")) {
    return {
      label: "Sysselsetting i yrket",
      description: "Utvikling i sysselsetting for relevante yrker.",
      source: "Kilde: Statistisk sentralbyrå",
    };
  }
  if (k.includes("nho_comp") || k.includes("competence") || lbl.includes("kompetanseområd") || lbl.includes("fagområd")) {
    return {
      label: "Etterspurte kompetanseområder",
      description: "Fagområder og utdanningsnivåer arbeidsgivere oppgir behov for.",
      source: "Kilde: NHO Kompetansebarometeret",
    };
  }
  if (k.includes("nho") || lbl.includes("nho") || lbl.includes("arbeidsgiver")) {
    return {
      label: "Arbeidsgiveres kompetansebehov",
      description:
        "Andel arbeidsgivere som melder udekket kompetansebehov i relevante bransjer eller områder.",
      source: "Kilde: NHO Kompetansebarometeret",
    };
  }
  // Fallback: strip raw table IDs from source.
  return {
    label: c.label,
    description: c.description,
    source: (c.source || "").replace(/SSB\s*\d{4,6}/g, "Statistisk sentralbyrå"),
  };
}

function DemandBreakdown({ components }: { components: DemandComponent[] }) {
  if (components.length === 0) return null;
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<TrendingUp className="h-4 w-4" />}
        title="Hva bygger signalet på?"
        subtitle="Komponenter som påvirker markedssignalet"
      />
      <div className="grid gap-3 md:grid-cols-3">
        {components.map((c) => {
          const h = humanizeComponent(c);
          return (
          <div
            key={c.key}
            className="rounded-xl border bg-card p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium leading-tight">{h.label}</div>
              <Badge variant="outline" className="text-[10px] py-0 h-5 shrink-0">
                {demandLevelLabel(c.level)}
              </Badge>
            </div>
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full", levelToneClass(c.level))}
                  style={{ width: `${Math.max(2, Math.min(100, c.value))}%` }}
                />
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                Indikator {c.value.toFixed(0)} / 100
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {h.description}
            </p>
            <div className="text-[11px] text-muted-foreground">
              {h.source}
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}

function CompetenciesSection({
  competencies,
}: {
  competencies?: CareerExplorerPayload["competencies"];
}) {
  const must = competencies?.must_have ?? [];
  const nice = competencies?.nice_to_have ?? [];

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<GraduationCap className="h-4 w-4" />}
        title="Kompetanseprofil"
        subtitle="Typiske kompetanser knyttet til denne stillingen."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <CompetencyGroup
          title="Må-ha-kompetanser"
          tone="primary"
          items={must}
          emptyText="Ingen må-ha-kompetanser registrert."
        />
        <CompetencyGroup
          title="Kompetanser som styrker profilen"
          tone="muted"
          items={nice}
          emptyText="Ingen tilleggskompetanser registrert."
        />
      </div>
    </section>
  );
}

function CompetencyGroup({
  title,
  tone,
  items,
  emptyText,
}: {
  title: string;
  tone: "primary" | "muted";
  items: CompetencyItem[];
  emptyText: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const VISIBLE = 8;
  const shown = expanded ? items : items.slice(0, VISIBLE);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-xs text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((it) => (
              <li
                key={it.uri}
                className={cn(
                  "inline-flex items-center rounded-md border px-2 py-1 text-xs",
                  tone === "primary"
                    ? "bg-primary/5 border-primary/20 text-foreground"
                    : "bg-background text-foreground"
                )}
                title={it.reason ?? undefined}
              >
                {it.label}
              </li>
            ))}
          </ul>
          {items.length > VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-primary hover:underline"
            >
              {expanded ? "Vis færre" : `Vis flere (${items.length - VISIBLE})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function IndustriesSection({
  industries,
  selectedIndustrySlug,
  selectedIndustryName,
}: {
  industries?: CareerExplorerPayload["industries"];
  selectedIndustrySlug: string | null;
  selectedIndustryName: string | null;
}) {
  const allMatches = industries?.matches ?? [];
  const allSignals = industries?.national_signals ?? [];
  const matches = allMatches.filter(
    (m) => !isActiveIndustry({ slug: m.slug, name: m.name }, selectedIndustrySlug, selectedIndustryName),
  );
  const signals = allSignals.filter(
    (s) => !isActiveIndustry({ name: s.name }, selectedIndustrySlug, selectedIndustryName),
  );

  const hadAny = allMatches.length > 0 || allSignals.length > 0;
  const hasAny = matches.length > 0 || signals.length > 0;
  const activeFilteredOut = hadAny && !hasAny && !!(selectedIndustrySlug || selectedIndustryName);

  if (!hadAny) return null;

  const filteredAway =
    !!(selectedIndustrySlug || selectedIndustryName) &&
    (allMatches.length !== matches.length || allSignals.length !== signals.length);
  const activeLabel =
    selectedIndustryName ??
    allMatches.find((m) =>
      isActiveIndustry({ slug: m.slug, name: m.name }, selectedIndustrySlug, selectedIndustryName),
    )?.name ?? selectedIndustrySlug ?? "valgt bransje";
  const title = filteredAway
    ? "Andre bransjer som kan være relevante"
    : "Relevante bransjer";
  const subtitle = filteredAway
    ? "Bransjer ved siden av den du har filtrert på."
    : "Bransjer som er knyttet til yrket";

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Building2 className="h-4 w-4" />}
        title={title}
        subtitle={subtitle}
      />
      <div className="rounded-xl border bg-card p-4 space-y-3">
        {activeFilteredOut ? (
          <p className="text-sm text-muted-foreground">
            Du har filtrert på {activeLabel}. Vi finner ikke andre bransjer med
            tydelig nok kobling i dette utvalget.
          </p>
        ) : (
          <>
            {matches.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {matches.map((m) => (
                  <Badge key={m.slug} variant="secondary">
                    {m.name}
                  </Badge>
                ))}
              </div>
            )}
            {signals.length > 0 && (
              <ul className="divide-y -mx-1">
                {signals.map((s, i) => (
                  <NationalSignalRow key={i} signal={s} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function NationalSignalRow({ signal }: { signal: IndustryNationalSignal }) {
  const change = toNumber(signal.percent_change);
  const employed = toNumber(signal.employed_latest);
  return (
    <li className="flex items-center justify-between gap-3 px-1 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{signal.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {employed != null
            ? `Sysselsatte: ${num(employed)}`
            : "Sysselsetting: ikke oppgitt"}
          {signal.latest_year ? ` · ${signal.latest_year}` : ""}
        </div>
      </div>
      {change != null && (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs tabular-nums whitespace-nowrap",
            change > 0
              ? "text-[var(--km-success)]"
              : change < 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-muted-foreground",
          )}
          title="Endring fra forrige år"
        >
          {change > 0 ? (
            <TrendingUp className="h-3 w-3" />
          ) : change < 0 ? (
            <TrendingDown className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          Endring fra forrige år: {pct(change)}
        </span>
      )}
    </li>
  );
}

type RegionSegment =
  | "tydeligst"
  | "vekst_pct"
  | "vekst_abs"
  | "nedgang_pct"
  | "nedgang_abs";

const REGION_SEGMENTS: { value: RegionSegment; label: string }[] = [
  { value: "tydeligst", label: "Tydeligst signal" },
  { value: "vekst_pct", label: "Størst vekst i %" },
  { value: "vekst_abs", label: "Størst vekst i antall" },
  { value: "nedgang_pct", label: "Størst nedgang i %" },
  { value: "nedgang_abs", label: "Størst nedgang i antall" },
];

function regionAbsChange(r: RegionSignal): number | null {
  const direct = toNumber(r.absolute_change);
  if (direct != null) return direct;
  const latest = toNumber(r.employed_latest);
  const prev = toNumber(r.employed_previous);
  if (latest != null && prev != null) return latest - prev;
  return null;
}

function RegionsSection({
  regions,
  regionCode,
  selectedRegionLabel,
}: {
  regions: RegionSignal[];
  regionCode: string | null;
  selectedRegionLabel: string | null;
}) {
  const [segment, setSegment] = useState<RegionSegment>("tydeligst");

  const filtered = regions.filter(
    (r) => !isActiveRegion(r, regionCode, selectedRegionLabel),
  );

  const allActiveFilteredOut =
    regions.length > 0 && filtered.length === 0 && !!regionCode;

  // Sort/filter per segment
  let segmentRows: RegionSignal[] = [];
  if (segment === "tydeligst") {
    segmentRows = filtered
      .slice()
      .sort(
        (a, b) =>
          (toNumber(b.relevance_score) ?? toNumber(b.region_signal_score) ?? 0) -
          (toNumber(a.relevance_score) ?? toNumber(a.region_signal_score) ?? 0),
      );
  } else if (segment === "vekst_pct") {
    segmentRows = filtered
      .filter((r) => {
        const v = toNumber(r.percent_change);
        return v != null && v > 0;
      })
      .sort((a, b) => (toNumber(b.percent_change) ?? 0) - (toNumber(a.percent_change) ?? 0));
  } else if (segment === "vekst_abs") {
    segmentRows = filtered
      .filter((r) => {
        const v = regionAbsChange(r);
        return v != null && v > 0;
      })
      .sort((a, b) => (regionAbsChange(b) ?? 0) - (regionAbsChange(a) ?? 0));
  } else if (segment === "nedgang_pct") {
    segmentRows = filtered
      .filter((r) => {
        const v = toNumber(r.percent_change);
        return v != null && v < 0;
      })
      .sort((a, b) => (toNumber(a.percent_change) ?? 0) - (toNumber(b.percent_change) ?? 0));
  } else if (segment === "nedgang_abs") {
    segmentRows = filtered
      .filter((r) => {
        const v = regionAbsChange(r);
        return v != null && v < 0;
      })
      .sort((a, b) => (regionAbsChange(a) ?? 0) - (regionAbsChange(b) ?? 0));
  }

  if (regions.length === 0) return null;

  const max = Math.max(
    ...segmentRows.map(
      (r) =>
        toNumber(r.relevance_score) ?? toNumber(r.region_signal_score) ?? 0,
    ),
    1,
  );

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<MapPin className="h-4 w-4" />}
        title="Regionale arbeidsmarkeder"
        subtitle="Sysselsetting, vekst og nedgang i utvalget."
      />
      <div className="flex flex-wrap gap-1.5">
        {REGION_SEGMENTS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setSegment(s.value)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              segment === s.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent/40",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="rounded-xl border bg-card p-4">
        {allActiveFilteredOut ? (
          <p className="text-sm text-muted-foreground">
            Du har valgt {regionLabelFromCode(regionCode)}. Vi finner ikke andre
            områder med tydelig nok signal i dette utvalget.
          </p>
        ) : segmentRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {segment === "tydeligst"
              ? "Vi har ikke nok regionale signaler i dette utvalget."
              : "Vi finner ingen tydelig vekst/nedgang i dette utvalget."}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {segmentRows.slice(0, 10).map((r) => {
              const rel =
                toNumber(r.relevance_score) ??
                toNumber(r.region_signal_score) ??
                0;
              const change = toNumber(r.percent_change);
              const abs = regionAbsChange(r);
              const employed = toNumber(r.employed_latest);
              return (
                <li key={r.region_code} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium truncate">
                      {cleanRegionLabel(r.region_label)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      Sysselsatte: {employed != null ? num(employed) : "–"}
                      {change != null && (
                        <>
                          {" · "}
                          <span
                            className={cn(
                              change > 0
                                ? "text-[var(--km-success)]"
                                : change < 0
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "",
                            )}
                          >
                            Endring: {pct(change)}
                          </span>
                        </>
                      )}
                      {abs != null && (
                        <>
                          {" · "}
                          <span>
                            {abs > 0 ? "+" : ""}
                            {num(abs)} sysselsatte
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary/70"
                      style={{
                        width: `${Math.max(4, (rel / max) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function NearbySection({
  nearby,
  selectedOccupationUri,
  selectedDisplayTitle,
}: {
  nearby: NearbyOccupation[];
  selectedOccupationUri: string | null;
  selectedDisplayTitle: string | null;
}) {
  const filtered = nearby.filter(
    (n) => !isActiveOccupation(n, selectedOccupationUri, selectedDisplayTitle),
  );
  if (filtered.length === 0) return null;
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Compass className="h-4 w-4" />}
        title="Nærliggende karriereveier"
        subtitle="Basert på overlappende kompetanser – ikke en garantert karrierevei"
      />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filtered.slice(0, 9).map((n) => (
          <article
            key={n.occupation_uri}
            className="rounded-xl border bg-card p-4 space-y-2"
          >
            <h4 className="font-medium leading-tight">
              {formatOccupationTitle(n.title)}
            </h4>

            <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
              <span>{n.overlap_count} felles kompetanser</span>
              <span className="font-mono" title="Overlappindeks – ikke en prosentverdi">
                Overlappindeks: {n.overlap_score.toFixed(0)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary/70"
                style={{
                  width: `${Math.max(4, Math.min(100, n.overlap_score))}%`,
                }}
              />
            </div>
            {n.industry_names && n.industry_names.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {n.industry_names.slice(0, 3).map((name, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            {n.shared_skills && n.shared_skills.length > 0 && (
              <details className="group">
                <summary className="text-[11px] text-primary cursor-pointer hover:underline">
                  Se delte kompetanser
                </summary>
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {n.shared_skills.slice(0, 6).map((s) => (
                    <li key={s.skill_uri} className="truncate">
                      • {s.title_no}
                    </li>
                  ))}
                  {n.shared_skills.length > 6 && (
                    <li className="text-[11px]">
                      + {n.shared_skills.length - 6} flere
                    </li>
                  )}
                </ul>
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function LearnNextSection({
  competencies,
}: {
  competencies?: CareerExplorerPayload["competencies"];
}) {
  const ln = competencies?.learn_next;
  if (!ln) return null;
  const start = ln.start_with ?? [];
  const then = ln.then_consider ?? [];
  if (start.length === 0 && then.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<BookOpen className="h-4 w-4" />}
        title="Hvilke tilleggskompetanser kan åpne nye karriereveier?"
        subtitle={
          ln.guidance ??
          "Kompetanser som kan gjøre det lettere å bevege seg mot nærliggende roller."
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <LearnList title="Start med" items={start} tone="primary" />
        <LearnList title="Bygg videre med" items={then} tone="muted" />
      </div>
    </section>
  );
}

function LearnList({
  title,
  items,
  tone,
}: {
  title: string;
  items: { uri: string; label: string }[];
  tone: "primary" | "muted";
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="flex flex-wrap gap-1.5">
        {items.slice(0, 12).map((it) => (
          <li
            key={it.uri}
            className={cn(
              "inline-flex items-center rounded-md border px-2 py-1 text-xs",
              tone === "primary"
                ? "bg-primary/5 border-primary/20"
                : "bg-background"
            )}
          >
            {it.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ---------- Kompetansekrav (simple mode) ----------

function SimpleSkillsView({ payload }: { payload: CareerExplorerPayload }) {
  const s = payload.summary;
  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-6 space-y-2">
        <h2 className="text-xl md:text-2xl font-semibold">
          {formatOccupationTitle(s?.title ?? payload.query)}
        </h2>

        {s?.description && (
          <p className="text-sm text-muted-foreground max-w-3xl">
            {s.description}
          </p>
        )}
        <div className="rounded-md border bg-background/60 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2 mt-2">
          <Database className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Typiske kompetanser for yrket, basert på stillingsbeskrivelse og
            yrkesdata.{" "}
            <a href="#datagrunnlag" className="underline hover:text-foreground">
              Les om datagrunnlaget
            </a>
            .
          </span>
        </div>
      </section>

      <CompetenciesSection competencies={payload.competencies} />
      <LearnNextSection competencies={payload.competencies} />

      {payload.nearby_occupations && payload.nearby_occupations.length > 0 && (
        <section className="space-y-3">
          <SectionTitle
            icon={<Compass className="h-4 w-4" />}
            title="Andre roller med lignende kompetanse"
          />
          <NearbySection
            nearby={payload.nearby_occupations}
            selectedOccupationUri={null}
            selectedDisplayTitle={null}
          />

        </section>
      )}
    </div>
  );
}

// ============================================================
// Landing sections
// ============================================================

function FindOutSection() {
  const items = [
    "Hvilke kompetanser kreves typisk i et yrke?",
    "Hvilke kompetanser styrker profilen din?",
    "Hvordan ser markedssignalet ut?",
    "Hvilke bransjer og regioner er relevante?",
    "Hvilke nærliggende karriereveier finnes?",
    "Hva kan være smart å lære mer om?",
  ];
  return (
    <section className="space-y-3" id="hva-kan-du-finne-ut">
      <SectionTitle
        icon={<Sparkles className="h-4 w-4" />}
        title="Hva kan du finne ut?"
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((q) => (
          <div
            key={q}
            className="rounded-xl border bg-card p-4 text-sm font-medium"
          >
            {q}
          </div>
        ))}
      </div>
    </section>
  );
}

function DataSourcesSection({ sources }: { sources?: DataSource[] }) {
  const effective =
    sources && sources.length > 0 ? sources : FALLBACK_DATA_SOURCES;
  const visible = effective.filter(shouldRenderDataSource);
  return (
    <section id="datagrunnlag" className="space-y-3 scroll-mt-24">
      <SectionTitle
        icon={<Database className="h-4 w-4" />}
        title="Datagrunnlag"
        subtitle="Åpne datakilder som ligger til grunn for tjenesten"
      />
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((s, i) => {
          const heading = resolveDataSourceHeading(s);
          const body = resolveDataSourceBody(s);
          const href = s.source_url ?? s.url ?? null;
          return (
            <div key={i} className="rounded-xl border bg-card p-4 space-y-1">
              <h4 className="font-semibold text-sm">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-rule underline-offset-4 hover:text-[var(--km-blue)]"
                  >
                    {heading}
                  </a>
                ) : (
                  heading
                )}
              </h4>
              {body && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {body}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="rounded-md border border-rule bg-[var(--km-paper-warm)] px-4 py-3 text-sm text-[var(--km-ink-soft)]">
        Tjenesten gir ikke fasitsvar eller personlig karriererådgivning. Den
        kombinerer åpne datakilder for å gi et bedre utgangspunkt for refleksjon,
        samtale og videre utforsking.
      </div>
    </section>
  );
}

function HowToUseSection() {
  const points = [
    "Bruk markedssignalene som retning, ikke som garanti.",
    "Sammenlign flere yrker for å se hvilke kompetanser som går igjen.",
    "Se hvilke bransjer som vokser, faller eller holder seg stabile.",
    "Sjekk om bildet endrer seg når du velger fylke eller kommune.",
    "Bruk «størst vekst» og «størst nedgang» for å se hvor utviklingen går raskest.",
    "Sammenlign prosent og antall: høy prosent kan være små miljøer, mens høyt antall kan vise store arbeidsmarkeder.",
    "Utforsk nærliggende karriereveier for å finne roller du kanskje ikke hadde vurdert.",
    "Bruk NHO-signalene til å se hvilke fagområder og utdanningsnivåer arbeidsgivere peker på.",
    "Klikk på behovssignaler for å se relevante karriereretninger og bransjer.",
    "Se etter kompetanser som dukker opp på tvers av flere karriereretninger.",
    "Kombiner yrke, bransje og område for å gjøre bildet mer relevant for deg.",
    "Bruk resultatene som utgangspunkt for videre research, ikke som en fasit.",
  ];
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Info className="h-4 w-4" />}
        title="Slik kan du bruke resultatene"
      />
      <ul className="rounded-xl border bg-card p-4 space-y-2 text-sm">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================
// Behovskompass
// ============================================================

function signalType(s: EmployerDemandSignal): string {
  return (s.type ?? "").toLowerCase();
}

const UPSKILLING_TYPES = new Set([
  "competence_upskilling",
  "nho_competence_upskilling_need",
  "upskilling",
  "kompetanseheving",
]);

function NeedsCompass({ employerDemand }: { employerDemand?: EmployerDemand }) {
  const ed = employerDemand;
  const fields = (ed?.competence_fields ?? []).slice(0, 3);
  const signals = ed?.signals ?? [];

  const fieldSignals = signals.filter(
    (s) => signalType(s) === "nho_competence_field_need",
  );
  const eduSignals = signals.filter(
    (s) => signalType(s) === "nho_education_level_need",
  );
  const upskillSignals = signals.filter((s) => UPSKILLING_TYPES.has(signalType(s)));

  // Dedup labels på tvers av kort etter prioritet: fagområde → utdanning → kompetanseheving.
  const used = new Set<string>();
  function takeLabels(items: { label?: string | null }[], limit: number): string[] {
    const out: string[] = [];
    for (const it of items) {
      const label = (it.label ?? "").trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      out.push(label);
      if (out.length >= limit) break;
    }
    return out;
  }

  const fieldLabels = takeLabels(
    [
      ...fields.map((f) => ({ label: f.label })),
      ...fieldSignals.map((s) => ({ label: s.label })),
    ],
    4,
  );
  const eduLabels = takeLabels(eduSignals, 3);
  const upskillLabels = takeLabels(upskillSignals, 3);

  const fieldTopValue = fields.reduce<number | null>((acc, f) => {
    const v = toNumber(f.value) ?? toNumber(f.score);
    if (v == null) return acc;
    return acc == null ? v : Math.max(acc, v);
  }, null);
  const eduTopValue = eduSignals.reduce<number | null>((acc, s) => {
    const v = toNumber(s.value) ?? toNumber(s.high_intensity_value);
    if (v == null) return acc;
    return acc == null ? v : Math.max(acc, v);
  }, null);
  const upskillTopValue = upskillSignals.reduce<number | null>((acc, s) => {
    const v = toNumber(s.value) ?? toNumber(s.high_intensity_value);
    if (v == null) return acc;
    return acc == null ? v : Math.max(acc, v);
  }, null);

  type Card = {
    key: string;
    title: string;
    tone: ToneKey;
    level: string;
    body: string;
  };

  const cards: Card[] = [];

  if (fieldLabels.length > 0) {
    const tone = signalTone(fieldTopValue);
    cards.push({
      key: "fields",
      title: "Etterspurte fagområder",
      tone: toneForSignal(tone),
      level: signalToneLabel(tone),
      body: fieldLabels.join(" · "),
    });
  }
  if (eduLabels.length > 0) {
    const tone = signalTone(eduTopValue);
    cards.push({
      key: "edu",
      title: "Utdanningsnivå og kvalifikasjoner",
      tone: toneForSignal(tone),
      level: signalToneLabel(tone),
      body: eduLabels.join(" · "),
    });
  }
  if (upskillLabels.length > 0) {
    const tone = signalTone(upskillTopValue);
    cards.push({
      key: "upskill",
      title: "Kompetanseheving",
      tone: toneForSignal(tone),
      level: signalToneLabel(tone),
      body: upskillLabels.join(" · "),
    });
  }

  if (cards.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Target className="h-4 w-4" />}
        title="Behovskompass"
        subtitle="Hva arbeidsgivere etterspør – signaler, ikke fasit."
      />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const t = TONE[c.tone];
          return (
            <div
              key={c.key}
              className={cn(
                "rounded-lg border bg-card p-3 space-y-1.5",
                t.stripe,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold leading-tight">
                  {c.title}
                </h4>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
                    t.chip,
                  )}
                >
                  {c.level}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                {c.body}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Kilde: NHO Kompetansebarometeret. Indikator, ikke fasit.
      </p>
    </section>
  );
}


// ============================================================
// RegionSpotlight – "Hva peker seg ut i ditt område?"
// ============================================================

function RegionSpotlight({
  payload,
  regionCode,
  selectedRegionLabel,
  selectedOccupationUri,
  selectedDisplayTitle,
}: {
  payload: CareerExplorerPayload;
  regionCode: string | null;
  selectedRegionLabel: string | null;
  selectedOccupationUri: string | null;
  selectedDisplayTitle: string | null;
}) {
  const regions = (payload.geography?.regions ?? [])
    .filter((r) => !isActiveRegion(r, regionCode, selectedRegionLabel))
    .slice()
    .sort(
      (a, b) =>
        (toNumber(b.relevance_score) ?? toNumber(b.region_signal_score) ?? 0) -
        (toNumber(a.relevance_score) ?? toNumber(a.region_signal_score) ?? 0),
    );
  const nearby = (payload.nearby_occupations ?? [])
    .filter(
      (n) => !isActiveOccupation(n, selectedOccupationUri, selectedDisplayTitle),
    )
    .slice()
    .sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0));

  if (regions.length === 0 && nearby.length === 0) {
    return null;
  }

  const title = regionCode
    ? `Hva peker seg ut i ${regionLabelFromCode(regionCode)}?`
    : "Hva peker seg ut i datagrunnlaget?";

  const intro = regionCode
    ? "Områder og karriereretninger innenfor valgt utvalg."
    : "Områder og karriereretninger basert på tilgjengelig datagrunnlag.";

  const regionCards = regions.slice(0, 3);
  const nearbyCards = nearby.slice(0, 3);

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<MapPin className="h-4 w-4" />}
        title={title}
        subtitle={intro}
      />
      {regionCards.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Områder
          </h4>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {regionCards.map((r) => {
              const employed = toNumber(r.employed_latest);
              return (
                <div
                  key={`r-${r.region_code}`}
                  className="rounded-lg border bg-card p-3"
                >
                  <div className="text-sm font-semibold leading-tight">
                    {cleanRegionLabel(r.region_label)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">
                    Tydelig regionalt markedssignal
                    {employed != null ? ` · Sysselsatte: ${num(employed)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {nearbyCards.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Karriereretninger
          </h4>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {nearbyCards.map((n) => (
              <div
                key={`n-${n.occupation_uri}`}
                className="rounded-lg border bg-card p-3"
              >
                <div className="text-sm font-semibold leading-tight">
                  {formatOccupationTitle(n.title)}
                </div>
                <div className="text-xs text-muted-foreground mt-1 leading-snug">
                  Karriereretning som peker seg ut · Overlappindeks:{" "}
                  {Math.round(n.overlap_index ?? n.overlap_score ?? 0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Indikator, ikke fasit.</p>
    </section>
  );
}


// ============================================================
// Mulighetsmatrise
// ============================================================

const QUADRANT_ORDER = [
  "Nært og attraktivt",
  "Sterkt signal, krever kompetanseløft",
  "Nær overgang",
  "Verdt å undersøke",
  "Mangler markedssignal",
];

function quadrantKey(item: {
  quadrant_label?: string | null;
  market_signal_score?: number | null;
}): string {
  const lbl = item.quadrant_label?.trim();
  if (lbl && QUADRANT_ORDER.some((q) => q.toLowerCase() === lbl.toLowerCase())) {
    return QUADRANT_ORDER.find(
      (q) => q.toLowerCase() === lbl.toLowerCase(),
    ) as string;
  }
  if (item.market_signal_score == null) return "Mangler markedssignal";
  return lbl ?? "Verdt å undersøke";
}

function OpportunityMatrix({
  items,
  fallback,
  selectedOccupationUri,
  selectedDisplayTitle,
  selectedRegionCode,
}: {
  items: OpportunityMatrixItem[] | null;
  fallback: NearbyOccupation[];
  selectedOccupationUri: string | null;
  selectedDisplayTitle: string | null;
  selectedRegionCode: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  // Build normalized items from primary source or fallback.
  let normalized: OpportunityMatrixItem[] = [];
  if (items && items.length > 0) {
    normalized = items;
  } else if (fallback.length > 0) {
    normalized = fallback.map((n) => ({
      title: n.title,
      occupation_uri: n.occupation_uri,
      overlap_index: n.overlap_index ?? n.overlap_score,
      overlap_count: n.overlap_count,
      market_signal_score: n.market_signal_score ?? null,
      market_signal_level: n.market_signal_level ?? null,
      opportunity_score: n.opportunity_score ?? null,
      opportunity_level: n.opportunity_level ?? null,
      quadrant: n.quadrant ?? null,
      quadrant_label: n.quadrant_label ?? null,
      regional_signal: n.regional_signal ?? null,
    }));
  }

  // Filter out the active occupation.
  normalized = normalized.filter(
    (it) =>
      !isActiveOccupation(it, selectedOccupationUri, selectedDisplayTitle),
  );

  if (normalized.length === 0) return null;

  // Group by quadrant.
  const groups = new Map<string, OpportunityMatrixItem[]>();
  for (const it of normalized) {
    const key = quadrantKey(it);
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }

  const orderedGroups = QUADRANT_ORDER.filter((q) => groups.has(q)).map(
    (q) => [q, groups.get(q)!] as const,
  );
  for (const [k, v] of groups) {
    if (!QUADRANT_ORDER.includes(k)) orderedGroups.push([k, v] as const);
  }

  const MAX_VISIBLE = 8;
  const total = normalized.length;
  const visibleCount = expanded ? total : Math.min(MAX_VISIBLE, total);
  let shown = 0;

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Layers className="h-4 w-4" />}
        title="Mulighetsmatrise"
        subtitle="Markedssignal gjelder valgt utvalg. Overlappindeks gjelder kompetanseoverlapp."
      />
      <div className="space-y-4">
        {orderedGroups.map(([quadrant, list]) => {
          if (shown >= visibleCount) return null;
          const tone = quadrantTone(quadrant);
          const t = TONE[tone];
          const remaining = visibleCount - shown;
          const visibleList = list.slice(0, remaining);
          shown += visibleList.length;
          return (
            <div key={quadrant} className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    t.bar,
                  )}
                />
                <h4 className="text-sm font-semibold">{quadrant}</h4>
                <span className="text-xs text-muted-foreground">
                  ({list.length})
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {visibleList.map((it) => (
                  <OpportunityCard
                    key={it.occupation_uri}
                    item={it}
                    tone={tone}
                    selectedRegionCode={selectedRegionCode}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {total > MAX_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {expanded ? "Vis færre" : `Vis flere (${total - MAX_VISIBLE})`}
        </button>
      )}
    </section>
  );
}

function OpportunityCard({
  item,
  tone,
  selectedRegionCode,
}: {
  item: OpportunityMatrixItem;
  tone: ToneKey;
  selectedRegionCode: string | null;
}) {
  const t = TONE[tone];
  const overlap = Math.round(item.overlap_index ?? 0);
  const market = item.market_signal_score;
  const opp = item.opportunity_score;
  const region = item.regional_signal?.region_label
    ? cleanRegionLabel(item.regional_signal.region_label)
    : null;
  const regionLabel = region
    ? selectedRegionCode
      ? `Valgt område: ${region}`
      : `Sterkeste regionale signal: ${region}`
    : null;

  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-3 space-y-2",
        t.stripe,
      )}
    >
      <h5 className="text-sm font-semibold leading-tight">
        {formatOccupationTitle(item.title)}
      </h5>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground tabular-nums">
          Overlappindeks: {overlap}
        </span>
        {item.overlap_count != null && (
          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {item.overlap_count} felles kompetanser
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>
          Markedssignal:{" "}
          {market == null ? (
            <span className="italic">ikke nok data</span>
          ) : (
            <span className="tabular-nums font-medium text-foreground">
              {Math.round(market)}
            </span>
          )}
        </div>
        <div>
          Mulighetssignal:{" "}
          {opp == null ? (
            <span className="italic">ikke nok data</span>
          ) : (
            <span className="tabular-nums font-medium text-foreground">
              {Math.round(opp)}
            </span>
          )}
        </div>
        {regionLabel && <div>{regionLabel}</div>}
      </div>
    </article>
  );
}


// ============================================================
// Neste steg
// ============================================================

function NextSteps({
  onFocusRegion,
  onFocusSearch,
}: {
  onFocusRegion: () => void;
  onFocusSearch: () => void;
}) {
  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const steps: {
    icon: React.ReactNode;
    title: string;
    body: string;
    onClick: () => void;
  }[] = [
    {
      icon: <Compass className="h-4 w-4" />,
      title: "Sammenlign nærliggende",
      body: "Se hvilke karriereveier som ligner mest.",
      onClick: () => scrollTo("naerliggende"),
    },
    {
      icon: <GraduationCap className="h-4 w-4" />,
      title: "Bygg én ny kompetanse",
      body: "Finn et naturlig startpunkt for læring.",
      onClick: () => scrollTo("kompetanser"),
    },
    {
      icon: <MapPin className="h-4 w-4" />,
      title: "Sjekk valgt område",
      body: "Velg eller endre område for et mer relevant bilde.",
      onClick: onFocusRegion,
    },
    {
      icon: <Building2 className="h-4 w-4" />,
      title: "Utforsk bransjen",
      body: "Se relevante bransjer for denne retningen.",
      onClick: () => scrollTo("omrade"),
    },
    {
      icon: <ListChecks className="h-4 w-4" />,
      title: "Se må-ha-kompetanser",
      body: "Hva er typisk forventet i rollen.",
      onClick: () => scrollTo("kompetanser"),
    },
    {
      icon: <Lightbulb className="h-4 w-4" />,
      title: "Prøv en annen retning",
      body: "Søk på et nytt yrke for å sammenligne.",
      onClick: onFocusSearch,
    },
  ];

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Briefcase className="h-4 w-4" />}
        title="Neste steg"
        subtitle="Forslag til hva du kan gjøre videre."
      />
      <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => {
          const t = TONE.amber;
          return (
            <button
              key={s.title}
              type="button"
              onClick={s.onClick}
              className={cn(
                "text-left rounded-lg border bg-card p-3 hover:bg-accent/40 transition-colors",
                t.stripe,
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-md",
                    t.iconBg,
                  )}
                >
                  {s.icon}
                </span>
                <div className="text-sm font-semibold leading-tight">
                  {s.title}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
                {s.body}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
