import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  hashLeadUrl,
  insertJobLeadDeduped,
  registerLeadForUser,
} from "@/lib/job-leads/insert-job-lead.server";

const inputSchema = z.object({
  inputKind: z.enum(["url", "text"]),
  jobUrl: z.string().url("Ugyldig URL").max(2000).optional().nullable(),
  rawText: z.string().min(80, "Lim inn hele annonseteksten").max(60_000)
    .optional().nullable(),
});

type ExtractedJobAd = {
  title?: string | null;
  description?: string | null;
  companyName?: string | null;
  location?: string | null;
  url?: string | null;
  workType?: string | null;
  salary?: string | null;
  applicationDue?: string | null;
  requirements?: unknown;
};

type ScoringResultRow = {
  id: string;
  screening_status?: string | null;
  score?: number | null;
};

type ScoringResponse = {
  status?: string;
  ok?: boolean;
  score_version?: string;
  selected?: number;
  evaluated?: number;
  results?: ScoringResultRow[];
  failures?: Array<{ id: string; error: string }>;
  error?: string;
};

export type ImportManualJobLeadResult = {
  ok: boolean;
  jobLeadId: string | null;
  wasInserted: boolean;
  scoringCompleted: boolean;
  score: number | null;
  screeningStatus: string | null;
  screeningReasons: Array<
    string | { code?: string; label?: string; detail?: string }
  > | null;
  aiReasoning: string | null;
  aiMatchHighlights: string | null;
  aiConcerns: string | null;
  status: string | null;
  qualificationStatus: string | null;
  error?: string;
};

export const importManualJobLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ImportManualJobLeadResult> => {
    const { userId } = context;
    const authHeader = getRequestHeader("authorization");
    if (!authHeader) {
      throw new Error("Mangler autentiseringstoken");
    }

    const jobUrl = data.inputKind === "url" ? data.jobUrl?.trim() : null;
    const rawText = data.inputKind === "text" ? data.rawText?.trim() : null;
    if (data.inputKind === "url" && !jobUrl) {
      throw new Error("Lim inn en URL til stillingsannonsen");
    }
    if (data.inputKind === "text" && !rawText) {
      throw new Error("Lim inn annonseteksten");
    }

    const supabaseUrl = process.env["SUPABASE_URL"]!;
    const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"]!;

    // Trinn 1–2: hent og parse annonsen internt. Klienten sender aldri et
    // ferdig parsed objekt — parsing skjer alltid her.
    const extractRes = await fetch(
      `${supabaseUrl}/functions/v1/extract-job-ad`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
        },
        body: JSON.stringify(jobUrl ? { jobUrl } : { rawText }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!extractRes.ok) {
      const detail = (await extractRes.text().catch(() => "")).slice(0, 200);
      console.error("extract-job-ad failed", extractRes.status, detail);
      throw new Error(
        jobUrl
          ? "Kunne ikke hente eller lese annonsen fra URL-en"
          : "Kunne ikke tolke annonseteksten",
      );
    }
    const extractBody = await extractRes.json() as {
      success?: boolean;
      data?: ExtractedJobAd;
    };
    if (!extractBody.success || !extractBody.data) {
      throw new Error("Kunne ikke tolke annonsen — prøv å lime inn teksten");
    }
    const extracted = extractBody.data;
    const description = extracted.description?.trim() ?? "";
    if (description.length < 50) {
      throw new Error(
        "Fant ikke nok annonsetekst — lim inn hele annonseteksten manuelt",
      );
    }

    const sourceSystem = jobUrl ? "manual_url" : "manual_paste";
    const resolvedUrl = jobUrl ?? (extracted.url?.trim() || null);

    // Trinn 3: lagre eller dedupliser. RPC-en returnerer alltid rad-id:
    // enten den nye raden eller den deterministisk funne duplikaten.
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const now = new Date().toISOString();
    const { leadId, wasInserted } = await insertJobLeadDeduped(supabaseAdmin, {
      user_id: userId,
      title: extracted.title ?? null,
      company: extracted.companyName ?? null,
      location: extracted.location ?? null,
      work_type: extracted.workType ?? null,
      salary_text: extracted.salary ?? null,
      job_url: resolvedUrl,
      posted_text: description,
      raw_snippet: description.slice(0, 2000),
      source_system: sourceSystem,
      source_url_hash: hashLeadUrl(resolvedUrl),
      source_observed_at: now,
      received_at: now,
      application_due: extracted.applicationDue ?? null,
      status: "ny",
      qualification_status: "pending",
      raw_payload: {
        source: "manual",
        input_kind: data.inputKind,
        extracted,
      },
    });

    if (!leadId) {
      throw new Error("Kunne ikke lagre annonsen");
    }

    if (wasInserted) {
      await registerLeadForUser(supabaseAdmin, {
        userId,
        source: sourceSystem,
        priority: 1,
        jobUrl: resolvedUrl,
        title: extracted.title ?? null,
        company: extracted.companyName ?? null,
        location: extracted.location ?? null,
        refId: leadId,
      });
    }

    // Trinn 4: scoring i samme operasjon. Brukerens eget token videresendes
    // slik at edge-funksjonen scorer mot riktig brukers evidensgraf.
    let scoringCompleted = false;
    let scoringError: string | undefined;
    let resultRow: ScoringResultRow | undefined;
    let scoreVersion: string | undefined;
    try {
      const scoreRes = await fetch(
        `${supabaseUrl}/functions/v1/score-pending-opportunities`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: publishableKey,
            Authorization: authHeader,
          },
          body: JSON.stringify({
            source: "all",
            mode: "stale",
            limit: 1,
            job_lead_ids: [leadId],
          }),
          signal: AbortSignal.timeout(180_000),
        },
      );
      const scoring = await scoreRes.json().catch(() => ({})) as
        ScoringResponse;
      scoreVersion = scoring.score_version;
      if (!scoreRes.ok || scoring.status === "failed") {
        scoringError = scoring.error ?? `scoring_http_${scoreRes.status}`;
      } else {
        resultRow = (scoring.results ?? []).find((row) => row.id === leadId);
        const failure = (scoring.failures ?? []).find((f) => f.id === leadId);
        if (failure) {
          scoringError = failure.error;
        } else if (resultRow) {
          scoringCompleted = true;
        }
        // Hverken resultat eller feil for raden: modusfilteret har hoppet
        // over den fordi den allerede er vurdert med gjeldende versjon.
        // Det verifiseres mot raden under.
      }
    } catch (error) {
      scoringError = error instanceof Error ? error.message : "scoring_failed";
    }

    // Les alltid raden etter scoring for å returnere fersk tilstand — dekker
    // både nye scorer og duplikater som allerede var vurdert.
    const { data: leadRow } = await supabaseAdmin
      .from("job_leads")
      .select(
        "ai_score, match_score_version, screening_status, screening_reasons, ai_reasoning, ai_match_highlights, ai_concerns, status, qualification_status",
      )
      .eq("id", leadId)
      .eq("user_id", userId)
      .maybeSingle();

    const row = leadRow as {
      ai_score?: number | null;
      match_score_version?: string | null;
      screening_status?: string | null;
      screening_reasons?: unknown;
      ai_reasoning?: string | null;
      ai_match_highlights?: string | null;
      ai_concerns?: string | null;
      status?: string | null;
      qualification_status?: string | null;
    } | null;

    if (!scoringCompleted && !scoringError && row) {
      // Raden ble ikke valgt av scoringen: regnet som fullført kun hvis den
      // allerede har en score med gjeldende versjon.
      scoringCompleted =
        row.ai_score != null && row.match_score_version != null &&
        row.match_score_version === scoreVersion;
      if (!scoringCompleted) {
        scoringError = "scoring_not_selected";
      }
    }

    return {
      ok: true,
      jobLeadId: leadId,
      wasInserted,
      scoringCompleted,
      score: resultRow?.score ?? row?.ai_score ?? null,
      screeningStatus: resultRow?.screening_status ?? row?.screening_status ??
        null,
      screeningReasons: row?.screening_reasons ?? null,
      aiReasoning: row?.ai_reasoning ?? null,
      aiMatchHighlights: row?.ai_match_highlights ?? null,
      aiConcerns: row?.ai_concerns ?? null,
      status: row?.status ?? null,
      qualificationStatus: row?.qualification_status ?? null,
      ...(scoringError ? { error: scoringError } : {}),
    };
  });
