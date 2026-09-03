import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { marketSupabase } from "@/integrations/market-supabase/client";
import { analyzeTargetRoleGap } from "@/lib/target-role-gap.functions";
import type { RoleRequirement, TargetRoleGapResult } from "@/lib/target-role-gap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Search, Target } from "lucide-react";

export const Route = createFileRoute("/_authenticated/karriere/gap")({
  head: () => ({
    meta: [
      { title: "Gap mot målrolle | Karrieren min" },
      {
        name: "description",
        content:
          "Sammenlign kompetansekravene for en målrolle med det du faktisk har bekreftet i karriereprofilen din.",
      },
      { property: "og:title", content: "Gap mot målrolle | Karrieren min" },
      {
        property: "og:description",
        content: "Se hvilke krav til målrollen som har belegg i profilen din, og hva som mangler.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GapPage,
});

type EscoHit = { occupation_uri?: string | null; title?: string | null; title_no?: string | null };

type ExplorerPayload = {
  found?: boolean;
  summary?: { title?: string } | null;
  competencies?: {
    must_have?: { uri?: string | null; label?: string | null }[];
    nice_to_have?: { uri?: string | null; label?: string | null }[];
  } | null;
};

function bandLabel(band: TargetRoleGapResult["band"]): string {
  if (band === "strong") return "God dekning";
  if (band === "moderate") return "Delvis dekning";
  return "Svak dekning";
}

function GapPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ title: string; uri: string | null } | null>(null);
  const [result, setResult] = useState<TargetRoleGapResult | null>(null);

  const searchQuery = useQuery({
    queryKey: ["gap-esco-search", query],
    enabled: query.trim().length >= 2,
    queryFn: async (): Promise<EscoHit[]> => {
      const { data, error } = await marketSupabase.rpc("search_esco_occupations", {
        search_text: query.trim(),
        filter_industry_slugs: null,
        result_limit: 8,
      });
      if (error) throw new Error("Kunne ikke søke etter yrker akkurat nå.");
      return (data ?? []) as EscoHit[];
    },
  });

  const requirementsQuery = useQuery({
    queryKey: ["gap-esco-requirements", selected?.title],
    enabled: !!selected?.title,
    queryFn: async (): Promise<RoleRequirement[]> => {
      const { data, error } = await marketSupabase.rpc("get_career_direction_explorer", {
        search_text: selected!.title,
        filter_region_code: null,
        filter_industry_slug: null,
      });
      if (error) throw new Error("Kunne ikke hente kompetansekravene for rollen.");
      const payload = (data ?? {}) as ExplorerPayload;
      const must = (payload.competencies?.must_have ?? [])
        .filter((c) => !!c.label)
        .map((c) => ({ uri: c.uri ?? null, label: String(c.label), level: "must_have" as const }));
      const nice = (payload.competencies?.nice_to_have ?? [])
        .filter((c) => !!c.label)
        .map((c) => ({ uri: c.uri ?? null, label: String(c.label), level: "nice_to_have" as const }));
      return [...must, ...nice].slice(0, 120);
    },
  });

  const analyze = useServerFn(analyzeTargetRoleGap);
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Velg en målrolle først.");
      const reqs = requirementsQuery.data ?? [];
      if (reqs.length === 0) throw new Error("Fant ingen kompetansekrav for denne rollen.");
      return analyze({ data: { role: selected, requirements: reqs } });
    },
    onSuccess: (res: any) => {
      if (!res?.ok) {
        toast.error("Kunne ikke lagre analysen", { description: res?.message ?? res?.errorCode });
        return;
      }
      setResult(res.result as TargetRoleGapResult);
      toast.success("Gap-analysen er beregnet og lagret");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Noe gikk galt");
    },
  });

  const hits = searchQuery.data ?? [];
  const reqCount = requirementsQuery.data?.length ?? 0;

  const grouped = useMemo(() => {
    if (!result) return null;
    return {
      must: result.requirements.filter((r) => r.level === "must_have"),
      nice: result.requirements.filter((r) => r.level === "nice_to_have"),
    };
  }, [result]);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Gap mot målrolle</h1>
        <p className="text-sm text-muted-foreground">
          Velg en målrolle, så sammenligner vi kompetansekravene fra yrkesregisteret med det du selv
          har bekreftet i karriereprofilen din. Analysen er regelbasert — ingen KI er involvert.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Velg målrolle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Søk etter yrke, for eksempel «salgsdirektør»"
              className="pl-9"
            />
          </div>

          {searchQuery.isFetching ? (
            <p className="text-sm text-muted-foreground">Søker …</p>
          ) : null}

          {hits.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {hits.map((h, i) => {
                const title = (h.title_no ?? h.title ?? "").trim();
                if (!title) return null;
                const active = selected?.title === title;
                return (
                  <Button
                    key={`${h.occupation_uri ?? i}`}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => {
                      setSelected({ title, uri: h.occupation_uri ?? null });
                      setResult(null);
                    }}
                  >
                    {title}
                  </Button>
                );
              })}
            </div>
          ) : null}

          {selected ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <Target className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{selected.title}</span>
              {requirementsQuery.isFetching ? (
                <span className="text-sm text-muted-foreground">Henter kompetansekrav …</span>
              ) : (
                <span className="text-sm text-muted-foreground">{reqCount} krav funnet</span>
              )}
              <Button
                className="ml-auto"
                size="sm"
                disabled={reqCount === 0 || analyzeMutation.isPending}
                onClick={() => analyzeMutation.mutate()}
              >
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Beregner …
                  </>
                ) : (
                  "Beregn gap"
                )}
              </Button>
            </div>
          ) : null}

          {requirementsQuery.isError ? (
            <p className="text-sm text-destructive">
              Kunne ikke hente kompetansekravene for rollen. Prøv et annet yrke eller igjen om litt.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result && grouped ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                2. Dekningsgrad mot «{result.role.title}»
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-3xl font-semibold">{result.coverageScore0to100} %</span>
                <Badge variant={result.band === "weak" ? "destructive" : "secondary"}>
                  {bandLabel(result.band)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {result.mustHaveCovered} av {result.mustHaveTotal} må-ha-krav har belegg ·{" "}
                  {result.niceToHaveCovered} av {result.niceToHaveTotal} bra-å-ha-krav
                </span>
              </div>
              <Progress value={result.coverageScore0to100} />
              <p className="text-xs text-muted-foreground">
                Belegg betyr at minst én brukerbekreftet påstand i profilen din berører kravet.
                Kravene kommer fra det europeiske yrkesregisteret (ESCO), samme kilde som
                Markedsinnsikt bruker.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Krav og belegg</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <RequirementList title="Må ha" rows={grouped.must} />
              <Separator />
              <RequirementList title="Bra å ha" rows={grouped.nice} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function RequirementList({
  title,
  rows,
}: {
  title: string;
  rows: TargetRoleGapResult["requirements"];
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">Ingen krav i denne gruppen for valgt rolle.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={`${r.level}-${r.uri ?? r.label}`} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={r.covered ? "secondary" : "outline"}>
                {r.covered ? "Har belegg" : "Mangler belegg"}
              </Badge>
              <span className="text-sm">{r.label}</span>
            </div>
            {r.matches.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Bygger på: {r.matches.map((m) => m.label).join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
