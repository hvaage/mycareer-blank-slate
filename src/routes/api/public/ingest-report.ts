import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeDomain } from "@/lib/normalize-domain";
import { SKILL_INGEST_KEY } from "@/lib/skill-ingest";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-schema-version, x-client-info",
  "Access-Control-Max-Age": "86400",
};

const LANGS = [
  "nb",
  "no",
  "sv",
  "da",
  "en",
  "de",
  "fr",
  "es",
  "it",
  "nl",
  "fi",
  "pl",
] as const;
const TIERS = ["standard", "extended"] as const;
const DIM_LABELS = [
  "sourced",
  "partial",
  "insufficient_data",
  "not_assessed",
] as const;

const dimensionSchema = z.object({
  name: z.string().min(1).max(120),
  score: z.number().min(0).max(5).nullable(),
  label: z.enum(DIM_LABELS),
  source_count: z.number().int().min(0).max(10000).optional().default(0),
});

const payloadSchema = z.object({
  schema_version: z.string().max(16),
  report_id: z.string().uuid(),
  submitted_at: z.string().min(10).max(40),
  language: z.enum(LANGS),
  tier: z.enum(TIERS),

  company: z.object({
    name: z.string().min(1).max(200),
    domain: z.string().min(1).max(200),
    branch_country: z.string().max(100).nullable().optional(),
    parent_country: z.string().max(100).nullable().optional(),
    analysis_date: z.string().max(20).nullable().optional(),
    employee_count: z.number().int().min(0).max(10_000_000).nullable().optional(),
    employee_count_source: z.string().max(60).nullable().optional(),
    employee_count_as_of: z.string().max(20).nullable().optional(),
    revenue_bucket: z.string().max(40).nullable().optional(),
    industry_nace: z.string().max(20).nullable().optional(),
  }),

  overall: z.object({
    score: z.number().min(0).max(5).nullable(),
    scored_dimensions: z.number().int().min(0).max(20),
    total_dimensions: z.number().int().min(1).max(20),
  }),

  dimensions: z.array(dimensionSchema).min(1).max(20),
  source_count: z.number().int().min(0).max(10000).optional().default(0),
  search_count: z.number().int().min(0).max(10000).optional().default(0),
  scope_deviation: z.boolean().optional().default(false),
});

const RATE_LIMIT_PER_DAY = 50;

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function ipHash(ip: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${today}`).digest("hex");
}

function checkKey(request: Request): boolean {
  const auth = request.headers.get("authorization") || "";
  const apikey = request.headers.get("apikey") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  return bearer === SKILL_INGEST_KEY || apikey === SKILL_INGEST_KEY;
}

export const Route = createFileRoute("/api/public/ingest-report")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        if (!checkKey(request)) {
          return Response.json(
            { error: "invalid_key" },
            { status: 401, headers: CORS_HEADERS }
          );
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json(
            { error: "invalid_json" },
            { status: 400, headers: CORS_HEADERS }
          );
        }

        const parsed = payloadSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            {
              error: "validation_failed",
              details: parsed.error.flatten(),
            },
            { status: 400, headers: CORS_HEADERS }
          );
        }
        const p = parsed.data;

        const ip = getClientIp(request);
        const ipH = ipHash(ip);

        // Soft rate-limit per IP per dag
        const sinceMidnight = new Date();
        sinceMidnight.setUTCHours(0, 0, 0, 0);
        const { count: todayCount } = await supabaseAdmin
          .from("employer_reports")
          .select("id", { count: "exact", head: true })
          .eq("ingest_ip_hash", ipH)
          .gte("created_at", sinceMidnight.toISOString());
        if ((todayCount ?? 0) >= RATE_LIMIT_PER_DAY) {
          return Response.json(
            { error: "rate_limited" },
            { status: 429, headers: CORS_HEADERS }
          );
        }

        // Idempotens — har vi sett denne report_id før?
        const { data: existing } = await supabaseAdmin
          .from("employer_reports")
          .select("id")
          .eq("report_id", p.report_id)
          .maybeSingle();
        if (existing) {
          return Response.json(
            { ok: true, deduped: true, id: existing.id },
            { status: 200, headers: CORS_HEADERS }
          );
        }

        const domain = normalizeDomain(p.company.domain) || p.company.domain;

        const insertRow = {
          report_id: p.report_id,
          submitted_at: p.submitted_at,
          schema_version: p.schema_version,
          language: p.language,
          tier: p.tier,
          company_name: p.company.name,
          company_domain: domain,
          branch_country: p.company.branch_country ?? null,
          parent_country: p.company.parent_country ?? null,
          analysis_date: p.company.analysis_date ?? null,
          employee_count: p.company.employee_count ?? null,
          employee_count_source: p.company.employee_count_source ?? null,
          employee_count_as_of: p.company.employee_count_as_of ?? null,
          revenue_bucket: p.company.revenue_bucket ?? null,
          industry_nace: p.company.industry_nace ?? null,
          overall_score: p.overall.score,
          scored_dimensions: p.overall.scored_dimensions,
          total_dimensions: p.overall.total_dimensions,
          dimensions: p.dimensions,
          source_count: p.source_count,
          search_count: p.search_count,
          scope_deviation: p.scope_deviation,
          ingest_ip_hash: ipH,
        };

        const { data: inserted, error } = await supabaseAdmin
          .from("employer_reports")
          .insert(insertRow)
          .select("id")
          .single();

        if (error) {
          // Race-håndtering: unique violation på report_id
          if ((error as { code?: string }).code === "23505") {
            return Response.json(
              { ok: true, deduped: true },
              { status: 200, headers: CORS_HEADERS }
            );
          }
          console.error("[ingest-report] insert error", error);
          return Response.json(
            { error: "insert_failed" },
            { status: 500, headers: CORS_HEADERS }
          );
        }

        return Response.json(
          { ok: true, id: inserted.id },
          { status: 200, headers: CORS_HEADERS }
        );
      },
    },
  },
});
