import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeDomain } from "@/lib/normalize-domain";

export type DimensionEntry = {
  name: string;
  score: number | null;
  label: string;
  source_count?: number;
};

export type ReportRow = {
  id: string;
  report_id: string;
  submitted_at: string;
  schema_version: string;
  language: string;
  tier: string;
  company_name: string;
  company_domain: string;
  branch_country: string | null;
  parent_country: string | null;
  analysis_date: string | null;
  employee_count: number | null;
  employee_count_source: string | null;
  employee_count_as_of: string | null;
  revenue_bucket: string | null;
  industry_nace: string | null;
  overall_score: number | null;
  scored_dimensions: number | null;
  total_dimensions: number | null;
  dimensions: DimensionEntry[];
  source_count: number | null;
  search_count: number | null;
  scope_deviation: boolean | null;
  created_at: string;
};

const SELECT_COLS =
  "id, report_id, submitted_at, schema_version, language, tier, company_name, company_domain, branch_country, parent_country, analysis_date, employee_count, employee_count_source, employee_count_as_of, revenue_bucket, industry_nace, overall_score, scored_dimensions, total_dimensions, dimensions, source_count, search_count, scope_deviation, created_at";

const listSchema = z.object({
  search: z.string().max(200).optional().default(""),
  country: z.string().max(100).optional().default(""),
  tier: z.string().max(40).optional().default(""),
  language: z.string().max(8).optional().default(""),
  sort: z
    .enum(["recent", "score", "most_reports"])
    .optional()
    .default("recent"),
  page: z.number().int().min(1).max(200).optional().default(1),
  pageSize: z.number().int().min(1).max(48).optional().default(24),
});

export const listReports = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => listSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("employer_reports")
      .select(SELECT_COLS, { count: "exact" });

    if (data.search.trim()) {
      const s = data.search.trim().replace(/[%_]/g, "");
      q = q.or(
        `company_name.ilike.%${s}%,company_domain.ilike.%${s}%`
      );
    }
    if (data.country.trim()) q = q.eq("branch_country", data.country.trim());
    if (data.tier.trim()) q = q.eq("tier", data.tier.trim());
    if (data.language.trim()) q = q.eq("language", data.language.trim());

    if (data.sort === "score") {
      q = q.order("overall_score", { ascending: false, nullsFirst: false });
    } else {
      q = q.order("submitted_at", { ascending: false });
    }

    // Hent stort utvalg så vi kan aggregere per domene før paginering
    const { data: rows, error } = await q.limit(500);
    if (error) throw new Error(error.message);

    type DomainGroup = {
      domain: string;
      latest: ReportRow;
      report_count: number;
    };
    const byDomain = new Map<string, DomainGroup>();
    for (const r of (rows ?? []) as ReportRow[]) {
      const key = r.company_domain;
      const cur = byDomain.get(key);
      if (!cur) {
        byDomain.set(key, { domain: key, latest: r, report_count: 1 });
      } else {
        cur.report_count += 1;
        if (r.submitted_at > cur.latest.submitted_at) cur.latest = r;
      }
    }
    let groups = Array.from(byDomain.values());
    if (data.sort === "most_reports") {
      groups.sort((a, b) => b.report_count - a.report_count);
    } else if (data.sort === "score") {
      groups.sort(
        (a, b) => (b.latest.overall_score ?? -1) - (a.latest.overall_score ?? -1)
      );
    } else {
      groups.sort((a, b) =>
        a.latest.submitted_at < b.latest.submitted_at ? 1 : -1
      );
    }

    const total = groups.length;
    const start = (data.page - 1) * data.pageSize;
    const paged = groups.slice(start, start + data.pageSize);

    // Filter-fasetter
    const countries = new Set<string>();
    const tiers = new Set<string>();
    const languages = new Set<string>();
    for (const g of groups) {
      if (g.latest.branch_country) countries.add(g.latest.branch_country);
      if (g.latest.tier) tiers.add(g.latest.tier);
      if (g.latest.language) languages.add(g.latest.language);
    }

    return {
      groups: paged,
      total,
      page: data.page,
      pageSize: data.pageSize,
      facets: {
        countries: Array.from(countries).sort(),
        tiers: Array.from(tiers).sort(),
        languages: Array.from(languages).sort(),
      },
    };
  });

export const getReport = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("employer_reports")
      .select(SELECT_COLS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { report: null, history: [] };

    const r = row as ReportRow;
    const { data: hist } = await supabaseAdmin
      .from("employer_reports")
      .select(SELECT_COLS)
      .eq("company_domain", r.company_domain)
      .order("submitted_at", { ascending: true })
      .limit(200);

    return { report: r, history: (hist ?? []) as ReportRow[] };
  });

export const getReportStats = createServerFn({ method: "GET" }).handler(
  async () => {
    const { count: total } = await supabaseAdmin
      .from("employer_reports")
      .select("id", { count: "exact", head: true });

    const since = new Date();
    since.setDate(since.getDate() - 7);
    const { count: last7 } = await supabaseAdmin
      .from("employer_reports")
      .select("id", { count: "exact", head: true })
      .gte("submitted_at", since.toISOString());

    const { data: latest } = await supabaseAdmin
      .from("employer_reports")
      .select(SELECT_COLS)
      .order("submitted_at", { ascending: false })
      .limit(5);

    return {
      total: total ?? 0,
      last7: last7 ?? 0,
      latest: (latest ?? []) as ReportRow[],
    };
  }
);

export const getLatestReports = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(20).default(3) }).parse(
      input ?? {}
    )
  )
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("employer_reports")
      .select(SELECT_COLS)
      .order("submitted_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    // Dedup per domene, behold nyeste
    const seen = new Set<string>();
    const out: ReportRow[] = [];
    for (const r of (rows ?? []) as ReportRow[]) {
      const d = normalizeDomain(r.company_domain);
      if (seen.has(d)) continue;
      seen.add(d);
      out.push(r);
      if (out.length >= data.limit) break;
    }
    return { reports: out };
  });
