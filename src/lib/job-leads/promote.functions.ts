// ============================================================
// Jobb-leads → Søknader / Muligheter.
//
// All skriving skjer som innlogget bruker (RLS) eller gjennom
// kanoniske SECURITY DEFINER-RPC-er som scoper på auth.uid().
// Klienten sender aldri user_id.
// ============================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CompanyMatchCandidate = {
  orgnr: string;
  navn: string;
  organisasjonsform?: string | null;
  kommune?: string | null;
  antall_ansatte?: number | null;
  score?: number | null;
};

export type CompanyMatchResult = {
  /** confirmed = koblet · suggested_possible/not_found = brukeren må velge */
  status: string;
  reconciliationId: string | null;
  observedName: string | null;
  companyId: string | null;
  orgnr: string | null;
  candidates: CompanyMatchCandidate[];
};

function toMatchResult(payload: unknown): CompanyMatchResult {
  const p = (payload ?? {}) as Record<string, unknown>;
  return {
    status: String(p.status ?? "unknown"),
    reconciliationId: (p.reconciliation_id as string) ?? null,
    observedName: (p.observed_name as string) ?? null,
    companyId: (p.company_id as string) ?? null,
    orgnr: (p.orgnr as string) ?? null,
    candidates: Array.isArray(p.candidates) ? (p.candidates as CompanyMatchCandidate[]) : [],
  };
}

function firstText(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  return items.length ? items : null;
}

/** Frist lagres som dato i job_ads. Ugyldige verdier droppes framfor å gjettes. */
function toDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const attachSchema = z.object({
  applicationId: z.string().uuid(),
  jobLeadId: z.string().uuid().nullable().optional(),
});

/**
 * Etter at et lead er flyttet til Søknader: legg annonseteksten på søknaden
 * (job_ads) og avstem selskapsnavnet mot arbeidsgiverregisteret.
 * Eksisterende manuell annonseimport overskrives aldri.
 */
export const attachJobAdAndCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => attachSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: app, error: appErr } = await context.supabase
      .from("applications")
      .select(
        "id, company_name, role_title, location, work_type, job_url, salary_text, raw_snippet, application_due, company_id",
      )
      .eq("id", data.applicationId)
      .maybeSingle();
    if (appErr || !app) {
      return { ok: false as const, jobAdCreated: false, match: null as CompanyMatchResult | null };
    }

    let jobAdCreated = false;
    const { data: existingAd } = await context.supabase
      .from("job_ads")
      .select("id")
      .eq("application_id", data.applicationId)
      .maybeSingle();

    if (!existingAd) {
      let extracted: Record<string, unknown> = {};
      let leadText: string | null = null;
      if (data.jobLeadId) {
        const { data: lead } = await context.supabase
          .from("job_leads")
          .select("raw_payload, raw_snippet, posted_text, job_url, application_due, salary_text")
          .eq("id", data.jobLeadId)
          .maybeSingle();
        const payload = (lead?.raw_payload ?? null) as Record<string, unknown> | null;
        const cand = payload?.extracted;
        if (cand && typeof cand === "object") extracted = cand as Record<string, unknown>;
        leadText = firstText(lead?.raw_snippet, lead?.posted_text);
      }

      const rawText = firstText(
        extracted.ad_markdown,
        extracted.raw_text,
        leadText,
        (app as Record<string, unknown>).raw_snippet,
      );

      // Uten reell annonsetekst opprettes ingen rad — da vises tomtilstanden
      // med importknappen, framfor et tomt «Stillingsannonse»-kort.
      if (rawText && rawText.length >= 200) {
        const { error: adErr } = await context.supabase.from("job_ads").insert({
          application_id: data.applicationId,
          raw_text: rawText,
          source_url: firstText(app.job_url) ?? null,
          application_deadline:
            toDateOnly(extracted.application_deadline) ?? toDateOnly(app.application_due),
          about_role: firstText(extracted.about_role),
          about_company: firstText(extracted.about_company),
          ideal_candidate: firstText(extracted.ideal_candidate),
          must_have_keywords: toStringArray(extracted.must_have_keywords),
          key_requirements: toStringArray(extracted.key_requirements),
          nice_to_have: toStringArray(extracted.nice_to_have),
          parsed_company: firstText(extracted.company, app.company_name),
          parsed_role: firstText(extracted.title, app.role_title),
          parsed_location: firstText(extracted.location, app.location),
          parsed_work_type: firstText(extracted.work_type, app.work_type),
          salary_info: firstText(extracted.salary_text, app.salary_text),
          imported_at: new Date().toISOString(),
        } as never);
        jobAdCreated = !adErr;
      }
    }

    let match: CompanyMatchResult | null = null;
    if (!app.company_id && firstText(app.company_name)) {
      const { data: res } = await context.supabase.rpc("network_company_reconcile_one" as never, {
        p_source_system: "application",
        p_source_record_id: data.applicationId,
        p_observed_name: app.company_name,
      } as never);
      match = toMatchResult(res);
    }

    return { ok: true as const, jobAdCreated, match };
  });

const promoteOppSchema = z.object({ jobLeadId: z.string().uuid() });

/**
 * Flytter et jobb-lead til Muligheter (status «saved») og avstemmer
 * selskapsnavnet i samme operasjon.
 */
export const promoteJobLeadToOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => promoteOppSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc(
      "job_lead_promote_to_opportunity" as never,
      { p_job_lead_id: data.jobLeadId } as never,
    );
    const payload = (res ?? null) as Record<string, unknown> | null;
    const status = error ? "write_failed" : String(payload?.status ?? "write_failed");
    if (status !== "promoted") {
      return { ok: false as const, status, opportunityId: null, match: null as CompanyMatchResult | null };
    }

    const opportunityId = (payload?.opportunity_id as string) ?? null;
    const company = (payload?.company as string) ?? null;

    let match: CompanyMatchResult | null = null;
    if (opportunityId && company && company.trim()) {
      const { data: rec } = await context.supabase.rpc("network_company_reconcile_one" as never, {
        p_source_system: "user_opportunity",
        p_source_record_id: opportunityId,
        p_observed_name: company,
      } as never);
      match = toMatchResult(rec);
    }

    return { ok: true as const, status, opportunityId, match };
  });

const setOppStatusSchema = z.object({
  opportunityId: z.string().uuid(),
  companyName: z.string().min(1),
});

/**
 * Careerjet/NAV-rader er allerede muligheter. Da settes bare status,
 * så det aldri oppstår duplikater.
 */
export const markOpportunitySelected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setOppStatusSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_opportunities")
      .update({ status: "saved", updated_at: new Date().toISOString() } as never)
      .eq("id", data.opportunityId);
    if (error) return { ok: false as const, match: null as CompanyMatchResult | null };

    const { data: rec } = await context.supabase.rpc("network_company_reconcile_one" as never, {
      p_source_system: "user_opportunity",
      p_source_record_id: data.opportunityId,
      p_observed_name: data.companyName,
    } as never);
    return { ok: true as const, match: toMatchResult(rec) };
  });
