// Lønnskontekst for valgt aldersgruppe (SSB via Markedsinnsikt).
//
// SSB publiserer lønn etter alder per næring, ikke for alle næringer samlet.
// Derfor velger brukeren bransje her. Panelet viser aldri et estimat eller
// null når dekningen mangler — da sier det eksplisitt at tall ikke finnes.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  supabase as marketSupabase,
  type Industry,
  type SalaryProfilePayload,
} from "@/lib/market";
import { getAgeGroup } from "@/lib/age-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  ageGroup: string | null;
  /** Bransjenavn fra profilen. Brukes til å forhåndsvelge riktig næring. */
  preferredIndustryName?: string | null;
};

function kr(v: number | null | undefined): string | null {
  if (v == null || Number.isNaN(v)) return null;
  return `${new Intl.NumberFormat("nb-NO").format(Math.round(v))} kr/mnd`;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function AgeSalaryContext({ ageGroup, preferredIndustryName = null }: Props) {
  const def = getAgeGroup(ageGroup);
  const [slug, setSlug] = useState<string>("");

  const industriesQuery = useQuery({
    queryKey: ["career-age-salary-industries"],
    staleTime: 60 * 60 * 1000,
    enabled: !!def,
    queryFn: async (): Promise<Industry[]> => {
      const { data, error } = await marketSupabase
        .from("industries")
        .select("slug, name_no, sort_order")
        .order("name_no", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Industry[];
    },
  });

  const industries = useMemo(() => industriesQuery.data ?? [], [industriesQuery.data]);

  useEffect(() => {
    if (slug || industries.length === 0 || !preferredIndustryName) return;
    const hit = industries.find((i) => normalize(i.name_no) === normalize(preferredIndustryName));
    if (hit) setSlug(hit.slug);
  }, [slug, industries, preferredIndustryName]);

  const query = useQuery({
    enabled: !!def && !!slug,
    staleTime: 10 * 60 * 1000,
    queryKey: ["career-age-salary", ageGroup, slug],
    queryFn: async (): Promise<SalaryProfilePayload> => {
      const { data, error } = await marketSupabase.rpc("get_public_salary_profile", {
        filter_industry_slug: slug,
        filter_nace_code: null,
        education_level: null,
        age_group: ageGroup,
        gender: null,
        sector: null,
        working_time: null,
      });
      if (error) throw new Error(error.message);
      return (data ?? {}) as SalaryProfilePayload;
    },
  });

  if (!def) return null;

  const payload = query.data;
  const ageKpi = payload?.kpis?.age_median ?? null;
  const median = kr(ageKpi?.median_salary ?? null);
  const noCoverage = !!payload && (payload.found === false || !median);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Lønnsnivå for din aldersgruppe</CardTitle>
        <CardDescription>
          Offisiell SSB-statistikk for {def.labelNb.toLowerCase()}. Et referansepunkt for bransjen — ikke
          en vurdering av deg.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="salary_industry">Bransje</Label>
          <Select value={slug || "__empty"} onValueChange={(v) => setSlug(v === "__empty" ? "" : v)}>
            <SelectTrigger id="salary_industry" className="w-full">
              <SelectValue placeholder="Velg bransje" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty">Ikke valgt</SelectItem>
              {industries.map((i) => (
                <SelectItem key={i.slug} value={i.slug}>
                  {i.name_no}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            SSB publiserer lønn etter alder per næring. Derfor må du velge bransje for å se tall.
          </p>
        </div>

        {!slug ? null : query.isLoading ? (
          <Skeleton className="h-10 w-48" />
        ) : query.isError ? (
          <p className="text-sm text-muted-foreground">
            Kunne ikke hente lønnstall akkurat nå. Prøv igjen senere.
          </p>
        ) : noCoverage ? (
          <p className="text-sm text-muted-foreground">
            SSB har ingen publiserte tall for denne kombinasjonen av bransje og aldersgruppe. Vi viser
            ingen anslag.
          </p>
        ) : (
          <div>
            <p className="text-2xl font-semibold text-foreground">{median}</p>
            <p className="text-xs text-muted-foreground">
              Median{ageKpi?.year ? ` · ${ageKpi.year}` : ""} · Kilde: SSB
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
