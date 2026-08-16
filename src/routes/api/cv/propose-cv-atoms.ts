// POST /api/cv/propose-cv-atoms
//
// Fase 3B: normaliserer parsekandidater fra én CV-import til atomforslag.
//
// Kanonisk inputkilde er public.cv_parse_candidates knyttet til public.cv_imports.
// `documents` brukes verken som evidenskilde eller normaliseringsinput.
// Klienten kan ikke sende tekst: bare cvImportId og eventuelt candidateIds.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - streng inputvalidering (zod .strict) — rawText/documentText gir 400
//   - user_id i body avvises
//   - Supabase-JWT verifiseres server-side; user_id kun fra auth-kontekst
//   - eierskap til importen håndheves med brukerens egen klient (RLS) før
//     service-credential brukes
//   - fremmed import gir 404 uten informasjonslekkasje
//   - sanitert JSON-feilmodell; ingen CV-tekst eller secrets i logg
//
// Skrivekontrakt:
//   - skriver KUN atom_enrichment_batches + atom_enrichment_proposals
//   - skriver ALDRI til career_atoms; brukerens gjennomgang og v4-apply er
//     eneste vei dit

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

import { callClaude, type ModelProfile } from "../../../../supabase/functions/_shared/claude/client.ts";
import {
  NORMALIZATION_SYSTEM_PROMPT_NO,
  NORMALIZATION_PROMPT_VERSION,
  buildNormalizationUserPrompt,
} from "../../../../supabase/functions/_shared/cv-skills/vendor/cv-atom-language-no/scripts/prompt.ts";
import { NORMALIZER_VERSION } from "../../../../supabase/functions/_shared/cv-skills/vendor/cv-atom-language-no/scripts/normalizer.ts";
import {
  buildSegments,
  computeSourceHash,
  parseNormalizationOutput,
  validateAndDedupe,
  vendorValidate,
  type CandidateInput,
} from "../../../../supabase/functions/_shared/cv-skills/atom-proposal-pipeline.ts";

const TASK_KEY = "cv_atom_language_no";
const CLAUDE_TIMEOUT_MS = 60_000;

type ErrorCode =
  | "method_not_allowed"
  | "invalid_origin"
  | "invalid_body"
  | "unauthorized"
  | "not_found"
  | "invalid_candidates"
  | "no_candidates"
  | "server_misconfigured"
  | "configuration_error"
  | "blocked_validation"
  | "provider_error"
  | "provider_timeout"
  | "database_error";

function fail(status: number, code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error: { code, message }, ...extra }, { status });
}

const UUID = z.string().uuid();

const bodySchema = z
  .object({
    cvImportId: UUID,
    candidateIds: z.array(UUID).min(1).max(300).optional(),
    correlation_id: UUID.optional(),
  })
  .strict();

function sameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const check = (value: string | null) => {
    if (!value) return null;
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };
  const o = check(request.headers.get("origin"));
  if (o !== null) return o;
  const r = check(request.headers.get("referer"));
  if (r !== null) return r;
  return true; // bearer-basert auth, ikke cookie: ingen ambient credentials å forfalske
}

export const Route = createFileRoute("/api/cv/propose-cv-atoms")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed", "Bruk POST."),
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const correlationId = crypto.randomUUID();

        if (!sameOrigin(request)) {
          return fail(403, "invalid_origin", "Forespørselen må komme fra samme opphav.");
        }

        const supabaseUrl = process.env["SUPABASE_URL"];
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        const anthropicKey = process.env["ANTHROPIC_API_KEY"];
        if (!supabaseUrl || !publishableKey) {
          return fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");
        }

        // ---------------------------------------------------------- input
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          raw = null;
        }
        if (raw && typeof raw === "object" && "user_id" in (raw as Record<string, unknown>)) {
          return fail(400, "invalid_body", "user_id kan ikke sendes i forespørselen.");
        }
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return fail(
            400,
            "invalid_body",
            "Ugyldig forespørsel. Bare cvImportId og candidateIds godtas — tekst kan ikke sendes inn.",
          );
        }
        const { cvImportId, candidateIds } = parsed.data;

        // ------------------------------------------------------------ jwt
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ") || authHeader.length < 16) {
          return fail(401, "unauthorized", "Mangler gyldig pålogging.");
        }
        const token = authHeader.slice("Bearer ".length);
        const userClient = createClient<Database>(supabaseUrl, publishableKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userError } = await userClient.auth.getUser();
        const userId = userData?.user?.id;
        if (userError || !userId) {
          return fail(401, "unauthorized", "Mangler gyldig pålogging.");
        }

        // ------------------------------------------------------- eierskap
        const { data: importRow, error: importError } = await userClient
          .from("cv_imports")
          .select("id, user_id, import_type, status")
          .eq("id", cvImportId)
          .eq("user_id", userId)
          .maybeSingle();
        if (importError) {
          return fail(500, "database_error", "Kunne ikke lese importen.");
        }
        if (!importRow) {
          // Samme svar for ukjent og fremmed import: ingen informasjonslekkasje.
          return fail(404, "not_found", "Fant ikke importen.");
        }

        // ----------------------------------------------------- kandidater
        const { data: candidateRows, error: candError } = await userClient
          .from("cv_parse_candidates")
          .select(
            "id, local_ref, suggested_atom_type, content_no, content_en, source_quote, structured_data, status, promoted_atom_id, import_id, user_id",
          )
          .eq("import_id", cvImportId)
          .eq("user_id", userId);
        if (candError) {
          return fail(500, "database_error", "Kunne ikke lese kandidatene.");
        }

        const all = (candidateRows ?? []) as (CandidateInput & {
          import_id: string;
          user_id: string;
        })[];
        const byId = new Map(all.map((c) => [c.id, c]));

        let selected = all;
        if (candidateIds) {
          const unknown = candidateIds.filter((id) => !byId.has(id));
          if (unknown.length > 0) {
            // Kandidater fra en annen import eller en annen bruker avvises samlet.
            return fail(
              400,
              "invalid_candidates",
              "Én eller flere kandidater hører ikke til denne importen.",
            );
          }
          selected = candidateIds.map((id) => byId.get(id)!);
        }

        // Allerede bekreftede kandidater kan ikke få nye forslag: de har
        // allerede nådd karriereoversikten gjennom gjennomgangen.
        const eligible = selected.filter(
          (c) => c.promoted_atom_id === null && c.status !== "bekreftet",
        );
        const segments = buildSegments(eligible);
        if (segments.length === 0) {
          return fail(400, "no_candidates", "Ingen kandidater til normalisering i denne importen.");
        }

        const sourceHash = await computeSourceHash(cvImportId, segments, NORMALIZATION_PROMPT_VERSION);

        // ------------------------------------------------ idempotens-sjekk
        const { data: existingBatch } = await userClient
          .from("atom_enrichment_batches")
          .select("id, created_at")
          .eq("user_id", userId)
          .eq("source_table", "cv_parse_candidates")
          .eq("source_id", cvImportId)
          .eq("source_hash", sourceHash)
          .maybeSingle();

        if (existingBatch) {
          const { count } = await userClient
            .from("atom_enrichment_proposals")
            .select("id", { count: "exact", head: true })
            .eq("batch_id", existingBatch.id);
          return Response.json(
            {
              ok: true,
              idempotent: true,
              cv_import_id: cvImportId,
              source_hash: sourceHash,
              batch_id: existingBatch.id,
              proposals_created: 0,
              proposals_existing: count ?? 0,
              anthropic_called: false,
              note: "Samme kildesignatur er allerede normalisert. Ingen nye forslag ble laget.",
              duration_ms: Date.now() - startedAt,
            },
            { status: 200 },
          );
        }

        if (!anthropicKey) {
          return fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");
        }

        // ------------------------------------------- service-credential nå
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: profileJson, error: profileError } = await supabaseAdmin.rpc(
          "internal_ai_get_active_profile" as never,
          { p_task_key: TASK_KEY } as never,
        );
        if (profileError || !profileJson) {
          return fail(500, "server_misconfigured", "Modellprofilen mangler.");
        }
        const pj = profileJson as unknown as {
          profile_id: string;
          profile_key: string;
          model_id: string;
          prompt_version: string;
          max_tokens: number;
          request_options: Record<string, unknown>;
          capabilities: Record<string, boolean>;
        };
        const profile: ModelProfile = {
          profileId: pj.profile_id,
          taskKey: TASK_KEY,
          modelId: pj.model_id,
          promptVersion: pj.prompt_version,
          maxTokens: pj.max_tokens,
          requestOptions: pj.request_options ?? {},
          capabilities: {
            supportsTemperature: pj.capabilities?.["supportsTemperature"] === true,
            supportsTopP: pj.capabilities?.["supportsTopP"] === true,
            supportsTopK: pj.capabilities?.["supportsTopK"] === true,
            supportsThinking: pj.capabilities?.["supportsThinking"] === true,
            supportsPrefill: pj.capabilities?.["supportsPrefill"] === true,
          },
        };

        const { data: modelRunId, error: runError } = await supabaseAdmin.rpc(
          "internal_ai_start_model_run" as never,
          {
            p_correlation_id: correlationId,
            p_user_id: userId,
            p_task_key: TASK_KEY,
            p_model_id: profile.modelId,
            p_profile_id: profile.profileId,
            p_profile_snapshot: {
              profile_key: pj.profile_key,
              prompt_version: profile.promptVersion,
              max_tokens: profile.maxTokens,
              request_options: profile.requestOptions,
              capabilities: pj.capabilities ?? {},
              source_hash: sourceHash,
              cv_import_id: cvImportId,
              segments: segments.length,
            },
            p_api_version: "2023-06-01",
          } as never,
        );
        if (runError || typeof modelRunId !== "string") {
          return fail(500, "database_error", "Kunne ikke starte modellkjøringen.");
        }

        const finishRun = async (input: {
          status: "succeeded" | "failed" | "configuration_error";
          outcome: string | null;
          errorCode: string | null;
          httpStatus: number | null;
          requestId: string | null;
          durationMs: number;
          retryCount: number;
          inputTokens: number | null;
          outputTokens: number | null;
        }) => {
          await supabaseAdmin.rpc("internal_ai_finish_model_run" as never, {
            p_model_run_id: modelRunId,
            p_status: input.status,
            p_outcome: input.outcome,
            p_error_code: input.errorCode,
            p_http_status: input.httpStatus,
            p_request_id: input.requestId,
            p_duration_ms: input.durationMs,
            p_retry_count: input.retryCount,
            p_input_tokens: input.inputTokens,
            p_output_tokens: input.outputTokens,
          } as never);
        };

        // ------------------------------------------------------- Claude
        const result = await callClaude({
          profile,
          system: NORMALIZATION_SYSTEM_PROMPT_NO,
          messages: [
            {
              role: "user",
              content: buildNormalizationUserPrompt({
                source_type: "cv_parse_candidates",
                source_id: cvImportId,
                source_hash: sourceHash,
                segments: segments.map((s) => ({ id: s.id, text: s.text })),
              }),
            },
          ],
          correlationId,
          timeoutMs: CLAUDE_TIMEOUT_MS,
          maxRetries: 1,
          runtime: { apiKey: anthropicKey },
        });

        if (!result.ok) {
          const isConfig = result.outcome === "configuration_error";
          await finishRun({
            status: isConfig ? "configuration_error" : "failed",
            outcome: isConfig ? "configuration_error" : result.outcome,
            errorCode: result.errorCode,
            httpStatus: result.status,
            requestId: result.requestId,
            durationMs: result.durationMs,
            retryCount: result.retryCount,
            inputTokens: null,
            outputTokens: null,
          });
          console.error(
            "[propose-cv-atoms] model step failed",
            JSON.stringify({ correlationId, outcome: result.outcome, errorCode: result.errorCode }),
          );
          if (isConfig) {
            return fail(500, "configuration_error", "Modelloppsettet er ikke gyldig.", {
              model_run_id: modelRunId,
              proposals_created: 0,
            });
          }
          return fail(
            result.outcome === "timeout" ? 504 : 502,
            result.outcome === "timeout" ? "provider_timeout" : "provider_error",
            "Analysen kunne ikke fullføres. Ingen forslag ble lagret.",
            { model_run_id: modelRunId, proposals_created: 0 },
          );
        }

        // ------------------------------------------- runtime-validering
        const parsedOut = parseNormalizationOutput(result.text);
        if (!parsedOut.ok) {
          await finishRun({
            status: "failed",
            outcome: "invalid_output",
            errorCode: "blocked_validation",
            httpStatus: 200,
            requestId: result.requestId,
            durationMs: result.durationMs,
            retryCount: result.retryCount,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          });
          return fail(422, "blocked_validation", "Svaret fra modellen var ikke gyldig.", {
            model_run_id: modelRunId,
            proposals_created: 0,
            validation_errors: parsedOut.errors.slice(0, 10),
          });
        }

        const batch = { ...parsedOut.batch, source_id: cvImportId, source_hash: sourceHash };
        const vendorCheck = vendorValidate(batch);

        const { kept, dropped } = validateAndDedupe(batch, segments, {
          cvImportId,
          sourceHash,
          modelRunId,
          promptVersion: profile.promptVersion,
          normalizerVersion: NORMALIZER_VERSION,
        });

        if (kept.length === 0) {
          await finishRun({
            status: "failed",
            outcome: "invalid_output",
            errorCode: "blocked_validation",
            httpStatus: 200,
            requestId: result.requestId,
            durationMs: result.durationMs,
            retryCount: result.retryCount,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          });
          return fail(422, "blocked_validation", "Ingen forslag besto evidenskontrollen.", {
            model_run_id: modelRunId,
            proposals_created: 0,
            dropped,
            vendor_errors: vendorCheck.errors.slice(0, 10),
          });
        }

        // ------------------------------------------------------- skriving
        const { data: batchRow, error: batchError } = await supabaseAdmin
          .from("atom_enrichment_batches")
          .insert({
            user_id: userId,
            source_type: "cv_import",
            source_table: "cv_parse_candidates",
            source_id: cvImportId,
            source_record_id: cvImportId,
            source_hash: sourceHash,
            title: "Språknormalisering av CV-import",
            status: "open",
            context: {
              task_key: TASK_KEY,
              model_run_id: modelRunId,
              model_id: profile.modelId,
              prompt_version: profile.promptVersion,
              normalizer_version: NORMALIZER_VERSION,
              correlation_id: correlationId,
              segments: segments.length,
              dropped,
              vendor_warnings: vendorCheck.warnings.slice(0, 20),
            },
          })
          .select("id")
          .single();
        if (batchError || !batchRow) {
          return fail(500, "database_error", "Kunne ikke lagre forslagene.");
        }

        const { data: insertedRows, error: proposalError } = await supabaseAdmin
          .from("atom_enrichment_proposals")
          .insert(
            kept.map((p) => ({
              batch_id: batchRow.id,
              user_id: userId,
              proposal_action: p.proposal_action,
              target_atom_type: p.target_atom_type,
              source_type: p.source_type,
              source_table: p.source_table,
              source_record_id: p.source_record_id,
              source_id: p.source_id,
              source_hash: p.source_hash,
              confidence: p.confidence,
              inferred: p.inferred,
              rationale: p.rationale,
              explanation: p.explanation,
              status: "pending_review" as const,
              proposal_payload: p.proposal_payload as never,
            })),
          )
          .select("id, source_record_id, proposal_action, proposal_payload");
        if (proposalError) {
          console.error(
            "[propose-cv-atoms] proposal insert failed",
            JSON.stringify({ correlationId, code: proposalError.code }),
          );
          return fail(500, "database_error", "Kunne ikke lagre forslagene.");
        }

        await finishRun({
          status: "succeeded",
          outcome: "ok",
          errorCode: null,
          httpStatus: 200,
          requestId: result.requestId,
          durationMs: result.durationMs,
          retryCount: result.retryCount,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });

        console.info(
          "[propose-cv-atoms] ok",
          JSON.stringify({
            correlationId,
            modelRunId,
            segments: segments.length,
            proposals: insertedRows?.length ?? 0,
            dropped: dropped.length,
            durationMs: Date.now() - startedAt,
          }),
        );

        return Response.json(
          {
            ok: true,
            phase: "3B",
            cv_import_id: cvImportId,
            source_hash: sourceHash,
            batch_id: batchRow.id,
            model_run_id: modelRunId,
            model_profile: {
              profile_key: pj.profile_key,
              model_id: profile.modelId,
              prompt_version: profile.promptVersion,
              max_tokens: profile.maxTokens,
            },
            segments: segments.length,
            proposals_created: insertedRows?.length ?? 0,
            proposals: ((insertedRows ?? []) as {
              id: string;
              proposal_action: string;
              source_record_id: string | null;
              proposal_payload: unknown;
            }[]).map((r) => ({
              id: r.id,
              proposal_action: r.proposal_action,
              cv_import_id: cvImportId,
              cv_parse_candidate_id: r.source_record_id,
              source_hash: sourceHash,
              source_quote:
                (r.proposal_payload as { source_quote?: string } | null)?.source_quote ?? null,
              content_no: (r.proposal_payload as { content_no?: string } | null)?.content_no ?? null,
              atom_type: (r.proposal_payload as { atom_type?: string } | null)?.atom_type ?? null,
            })),
            dropped,
            career_atoms_written: 0,
            note:
              "Forslagene venter på gjennomgang. Ingenting er skrevet til karriereoversikten.",
            duration_ms: Date.now() - startedAt,
          },
          { status: 200 },
        );
      },
    },
  },
});
