// @ts-nocheck
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Building2, Loader2, Search, ArrowUp, ArrowDown, ArrowUpDown, Clock, Plus } from "lucide-react";
import {
  EmployerAnalysisSearchDialog,
  type ExistingEmployerMatch,
} from "@/components/employers/EmployerAnalysisSearchDialog";
import type { EmployerSearchRow } from "@/lib/queries/employer-insight";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { supabase } from "@/lib/supabase";
import { messageFromFunctionInvokeError } from "@/lib/edge-invoke-error";
import { normalizeAiErrorMessage } from "@/lib/ai-ux-messages";
import type { ActiveEmployerAnalysisJobRow, EmployersPageData } from "@/lib/queries/companies";
import {
  activeEmployerAnalysisJobsQuery,
  candidateFitUiState,
  EMPLOYER_ANALYSIS_STEP_LABELS,
  myEmployersQuery,
  type UserRatingRow,
} from "@/lib/queries/companies";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/employers/")({
  component: EmployersPage,
});

type SortKey = "name" | "ai" | "fit" | "mine" | "agg";
type SortDir = "asc" | "desc";

/** List columns: AI selskap (companies), AI match (user_company_ratings fit), Kandidatscore (manual), Brukersnitt (agg). */
function EmployerListScore({
  variant,
  value,
  aggCount,
  fitRow,
}: {
  variant: "company_ai" | "ai_match" | "kandidatscore" | "bruksnitt";
  value: number | null | undefined;
  aggCount?: number;
  fitRow?: Pick<UserRatingRow, "ai_candidate_fit_score" | "ai_candidate_fit_reasoning"> | null;
}) {
  const n = aggCount ?? 0;
  const v = value == null || Number.isNaN(Number(value)) ? null : Number(value);

  if (variant === "bruksnitt") {
    if (n === 0) {
      return (
        <span className="text-muted-foreground text-xs leading-tight md:text-right block max-w-[10rem] md:max-w-none md:ml-auto">
          Ingen data
        </span>
      );
    }
    if (v == null) {
      return (
        <span className="text-muted-foreground text-xs leading-tight md:text-right block max-w-[10rem] md:max-w-none md:ml-auto">
          Ingen snitt ({n})
        </span>
      );
    }
    return (
      <span className="tabular-nums font-medium md:text-right block">
        {v.toFixed(1)}
        <span className="text-xs text-muted-foreground font-normal"> ({n})</span>
      </span>
    );
  }

  if (variant === "ai_match") {
    const state = candidateFitUiState(fitRow ?? null);
    if (state === "unavailable") {
      return (
        <span className="text-amber-700 dark:text-amber-500 text-xs md:text-right block max-w-[10rem] md:max-w-none md:ml-auto leading-tight">
          Kan ikke vurderes
        </span>
      );
    }
    if (state === "partial") {
      return (
        <span className="text-muted-foreground text-xs md:text-right block max-w-[10rem] md:max-w-none md:ml-auto leading-tight">
          Se detalj
        </span>
      );
    }
    if (state === "rated" && v != null) {
      return <span className="tabular-nums font-medium md:text-right block">{v.toFixed(1)}</span>;
    }
    return (
      <span className="text-muted-foreground text-xs md:text-right block max-w-[10rem] md:max-w-none md:ml-auto">
        Ikke vurdert
      </span>
    );
  }

  if (variant === "kandidatscore" && v == null) {
    return (
      <span className="text-muted-foreground text-xs md:text-right block max-w-[10rem] md:max-w-none md:ml-auto">
        Ikke vurdert
      </span>
    );
  }

  if (variant === "company_ai" && v == null) {
    return (
      <span className="text-muted-foreground text-xs md:text-right block max-w-[10rem] md:max-w-none md:ml-auto">
        Ikke analysert
      </span>
    );
  }

  return <span className="tabular-nums font-medium md:text-right block">{v!.toFixed(1)}</span>;
}

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = current === sortKey;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide ${
        active ? "text-foreground" : "text-muted-foreground"
      } hover:text-foreground transition-colors ${className ?? ""}`}
    >
      {label}
      <Icon className="h-3 w-3" />
    </button>
  );
}

function lastAnalyzeCompanyEntryEmployers(log: unknown) {
  const arr = Array.isArray(log) ? (log as unknown[]) : [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i] as { via?: string; status?: string } | null;
    if (e?.via === "analyze-company") return e;
  }
  return null;
}

function EmployersPage() {
  const qc = useQueryClient();
  useQuery({ ...activeEmployerAnalysisJobsQuery(), staleTime: 0 });

  const { data: employersData, isLoading } = useQuery({
    ...myEmployersQuery(),
    refetchInterval: () => {
      const active =
        qc.getQueryData<ActiveEmployerAnalysisJobRow[]>(["employer-analysis-jobs", "active"]) ?? [];
      const data = qc.getQueryData<EmployersPageData>(["employers"]);
      const jobs = Object.values(data?.jobsByCompanyId ?? {});
      const listActive = jobs.some((j) => j.status === "queued" || j.status === "processing");
      const listRateWait = jobs.some(
        (j) =>
          j.status === "rate_limited" &&
          j.retry_after_at &&
          new Date(j.retry_after_at) > new Date(),
      );
      return active.length > 0 || listActive || listRateWait ? 2500 : false;
    },
  });
  const employers = employersData?.employers ?? [];
  const jobsByCompanyId = employersData?.jobsByCompanyId ?? {};
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState<string>("all");
  const [minAi, setMinAi] = useState<number>(0);
  const [minMine, setMinMine] = useState<number>(0);
  const [minAgg, setMinAgg] = useState<number>(0);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const industries = useMemo(() => {
    const set = new Set<string>();
    (employers ?? []).forEach((e) => e.industry && set.add(e.industry));
    return Array.from(set).sort();
  }, [employers]);

  const filtered = useMemo(() => {
    const list = (employers ?? []).filter((e) => {
      if (search) {
        const q = search.toLowerCase();
        if (!(e.name?.toLowerCase().includes(q) || e.domain?.toLowerCase().includes(q))) {
          return false;
        }
      }
      if (industry !== "all" && e.industry !== industry) return false;
      if (minAi > 0 && (Number(e.ai_overall_score) || 0) < minAi) return false;
      if (minMine > 0 && (Number(e.myAvg) || 0) < minMine) return false;
      if (minAgg > 0 && (Number(e.agg_overall_score) || 0) < minAgg) return false;
      return true;
    });
    const getVal = (e: any): string | number => {
      switch (sortKey) {
        case "name": return (e.name ?? "").toLowerCase();
        case "ai": return Number(e.ai_overall_score ?? -1);
        case "fit": return Number(e.myFitScore ?? -1);
        case "mine": return Number(e.myAvg ?? -1);
        case "agg": return Number((e.agg_rating_count ?? 0) > 0 ? e.agg_overall_score ?? -1 : -1);
      }
    };
    const sorted = [...list].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      // tiebreak alphabetical
      return (a.name ?? "").localeCompare(b.name ?? "", "nb");
    });
    return sorted;
  }, [employers, search, industry, minAi, minMine, minAgg, sortKey, sortDir]);

  const handleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const [dialogOpen, setDialogOpen] = useState(false);

  const existingByOrgnr = useMemo(() => {
    const m = new Map<string, ExistingEmployerMatch>();
    (employers ?? []).forEach((e) => {
      const orgnr = (e as { organisasjonsnummer?: string | null }).organisasjonsnummer;
      if (orgnr && /^[0-9]{9}$/.test(orgnr)) {
        m.set(orgnr, { id: e.id, name: e.name ?? "" });
      }
    });
    return m;
  }, [employers]);

  const analyzeNew = useMutation({
    mutationFn: async (row: EmployerSearchRow) => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Ikke innlogget");
      if (!row.organisasjonsnummer || !/^[0-9]{9}$/.test(row.organisasjonsnummer)) {
        throw new Error("Ugyldig organisasjonsnummer");
      }
      const { data, error } = await supabase.functions.invoke("analyze-company", {
        body: { user_id: uid, organisasjonsnummer: row.organisasjonsnummer },
      });
      if (error) throw new Error(await messageFromFunctionInvokeError(error, data));
      if ((data as any)?.error) {
        throw new Error(
          normalizeAiErrorMessage(
            (data as any).message ?? String((data as any).error),
            { kind: "analysis" },
          ),
        );
      }
      return data as {
        company_id: string;
        company_name: string;
        status?: string;
        candidate_fit?: string;
        ai_rated_at?: string | null;
        already_running?: boolean;
      };
    },
    onSuccess: (res: any) => {
      if (res?.already_running) {
        toast.info("Analyse pågår allerede for dette selskapet", {
          description: "Følg med i listen — fremdrift hentes fra databasen.",
        });
      } else if (res?.status === "cached") {
        const dt = res.ai_rated_at ? new Date(res.ai_rated_at).toLocaleDateString("nb-NO") : "";
        toast.success(`Bruker eksisterende analyse for ${res.company_name}`, {
          description: `Selskapsanalyse fra ${dt}. Beregner din kandidatmatch…`,
        });
      } else if (res?.status === "pending") {
        toast.success(`Analyse startet for ${res.company_name}`, {
          description: "Behandler — siden oppdateres automatisk til resultatet er lagret.",
        });
      } else {
        toast.success(`Analyse startet for ${res.company_name}`, {
          description: "Henter informasjon fra nettet — dette kan ta et minutt.",
        });
      }
      qc.invalidateQueries({ queryKey: ["employers"] });
      qc.invalidateQueries({ queryKey: ["employer-analysis-job", res.company_id] });
      setDialogOpen(false);
      navigate({ to: "/employers/$companyId", params: { companyId: res.company_id } });
    },
    onError: (err: any) =>
      toast.error(normalizeAiErrorMessage(err?.message, { kind: "analysis" })),
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start gap-3 flex-wrap">
        <Building2 className="h-6 w-6 text-primary shrink-0 mt-1" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight">Arbeidsgivere</h1>
          <p className="text-sm text-muted-foreground">
            Selskaper du har søkt på, vurdert eller fått AI-analyse av
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4" /> Finn ny arbeidsgiver
        </Button>
      </header>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer mine arbeidsgivere"
                aria-label="Filtrer mine arbeidsgivere"
                className="pl-8"
              />
            </div>
            <Select value={industry} onValueChange={setIndustry}>
              <SelectTrigger>
                <SelectValue placeholder="Industri" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle industrier</SelectItem>
                {industries.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FilterSlider label="Min. AI selskap" value={minAi} onChange={setMinAi} />
            <FilterSlider label="Min. kandidatscore" value={minMine} onChange={setMinMine} />
            <FilterSlider label="Min. brukersnitt" value={minAgg} onChange={setMinAgg} />
          </div>
        </CardContent>
      </Card>

      <EmployerAnalysisSearchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existingByOrgnr={existingByOrgnr}
        isPending={analyzeNew.isPending}
        onAnalyzeConfirmed={(row) => analyzeNew.mutateAsync(row).then(() => undefined)}
        onOpenExisting={(companyId) => {
          setDialogOpen(false);
          navigate({ to: "/employers/$companyId", params: { companyId } });
        }}
      />


      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : employers.length === 0 ? (
        <EmptyState
          title="Ingen arbeidsgivere ennå"
          description="Bruk «Finn ny arbeidsgiver» øverst for å søke i arbeidsgiverregisteret og starte en analyse."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Ingen treff i dine arbeidsgivere"
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setIndustry("all");
                setMinAi(0);
                setMinMine(0);
                setMinAgg(0);
              }}
            >
              Nullstill filtre
            </Button>
          }
        />
      ) : (
        <Card>
          <div className="px-4 pt-3 pb-2 text-[11px] text-muted-foreground border-b bg-muted/20 leading-snug">
            <p>
              <strong className="text-foreground/90">AI selskap</strong> — felles AI-analyse for alle.{" "}
              <strong className="text-foreground/90">Match</strong> — din AI kandidatmatch (kun deg).{" "}
              <strong className="text-foreground/90">Kandidatscore</strong> — ditt manuelle snitt.{" "}
              <strong className="text-foreground/90">Brukersnitt</strong> — gjennomsnitt fra alle brukere.
            </p>
          </div>
          <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))] gap-3 px-4 py-3 border-b bg-muted/30 text-xs">
            <SortHeader label="Selskap" sortKey="name" current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortHeader label="AI selskap" sortKey="ai" current={sortKey} dir={sortDir} onSort={handleSort} className="justify-end" />
            <SortHeader label="Match" sortKey="fit" current={sortKey} dir={sortDir} onSort={handleSort} className="justify-end" />
            <SortHeader label="Kandidatscore" sortKey="mine" current={sortKey} dir={sortDir} onSort={handleSort} className="justify-end" />
            <SortHeader label="Brukersnitt" sortKey="agg" current={sortKey} dir={sortDir} onSort={handleSort} className="justify-end" />
          </div>
          <div className="md:hidden flex items-center justify-between gap-2 px-4 py-2 border-b bg-muted/30">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Sortér</span>
            <Select value={`${sortKey}:${sortDir}`} onValueChange={(v) => {
              const [k, d] = v.split(":") as [SortKey, SortDir];
              setSortKey(k); setSortDir(d);
            }}>
              <SelectTrigger className="h-8 w-auto text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name:asc">Navn A–Å</SelectItem>
                <SelectItem value="name:desc">Navn Å–A</SelectItem>
                <SelectItem value="ai:desc">AI selskap høyest</SelectItem>
                <SelectItem value="fit:desc">Match høyest</SelectItem>
                <SelectItem value="mine:desc">Kandidatscore høyest</SelectItem>
                <SelectItem value="agg:desc">Brukersnitt høyest</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ul className="divide-y">
            {filtered.map((c) => {
              const job = jobsByCompanyId[c.id];
              const ae = lastAnalyzeCompanyEntryEmployers((c as { research_log?: unknown }).research_log);
              const jobRunning = job?.status === "queued" || job?.status === "processing";
              const jobRateLimitedWait =
                job?.status === "rate_limited" &&
                job.retry_after_at &&
                new Date(job.retry_after_at) > new Date();
              const jobFailed = job?.status === "failed";
              const jobDone = job?.status === "completed";
              const legacyPending = ae?.status === "pending" && !job;
              const legacyFailed = ae?.status === "failed" && !jobFailed;

              return (
              <li key={c.id}>
                <Link
                  to="/employers/$companyId"
                  params={{ companyId: c.id }}
                  className="grid grid-cols-2 md:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))] gap-x-3 gap-y-1 px-4 py-2 hover:bg-accent/40 active:bg-accent/60 transition-colors"
                >
                  <div className="col-span-2 md:col-span-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      {jobRunning && (
                        <span className="inline-flex items-center gap-1 text-xs text-primary shrink-0" title="AI-analyse pågår">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {job?.progress_percent ?? 0}%
                        </span>
                      )}
                      {jobRateLimitedWait && (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500 shrink-0"
                          title="AI rate limit — prøv igjen om litt"
                        >
                          <Clock className="h-3 w-3" />
                          Vent
                        </span>
                      )}
                      {!jobRunning && !jobRateLimitedWait && jobDone && (
                        <span className="text-xs text-emerald-600 shrink-0" title="Siste analyse fullført">
                          Ferdig
                        </span>
                      )}
                      {!jobRunning && !jobRateLimitedWait && jobFailed && (
                        <span className="text-xs text-destructive shrink-0" title={job?.error_message ?? ""}>
                          Feilet
                        </span>
                      )}
                      {!jobRunning && !jobRateLimitedWait && !jobDone && !jobFailed && legacyPending && (
                        <span className="inline-flex items-center gap-1 text-xs text-primary shrink-0" title="AI-analyse pågår">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Behandler
                        </span>
                      )}
                      {!jobRunning && !jobRateLimitedWait && !jobDone && !jobFailed && legacyFailed && (
                        <span className="text-xs text-destructive shrink-0" title="Siste analyse feilet">
                          Feilet
                        </span>
                      )}
                    </div>
                    {(jobRunning || jobRateLimitedWait) && (
                      <div className="w-full max-w-xs pr-2">
                        <Progress value={job?.progress_percent ?? 0} className="h-1.5" />
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {EMPLOYER_ANALYSIS_STEP_LABELS[job?.current_step ?? ""] ?? job?.current_step ?? "…"}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="md:text-right">
                    <span className="md:hidden text-xs text-muted-foreground mr-1">AI selskap:</span>
                    <EmployerListScore variant="company_ai" value={c.ai_overall_score as number | null} />
                  </div>
                  <div className="md:text-right">
                    <span className="md:hidden text-xs text-muted-foreground mr-1">Match:</span>
                    <EmployerListScore variant="ai_match" value={c.myFitScore} fitRow={c.myRating} />
                  </div>
                  <div className="md:text-right">
                    <span className="md:hidden text-xs text-muted-foreground mr-1">Kandidatscore:</span>
                    <EmployerListScore variant="kandidatscore" value={c.myAvg} />
                  </div>
                  <div className="md:text-right">
                    <span className="md:hidden text-xs text-muted-foreground mr-1">Brukersnitt:</span>
                    <EmployerListScore
                      variant="bruksnitt"
                      value={c.agg_overall_score as number | null}
                      aggCount={c.agg_rating_count ?? 0}
                    />
                  </div>
                </Link>
              </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function FilterSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{value.toFixed(1)}</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={0}
        max={5}
        step={0.5}
      />
    </div>
  );
}
