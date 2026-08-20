// POST /api/internal/linkedin-import-worker
//
// Fase 2: intern rute for validering og staging av ett LinkedIn-arkiv.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - egen worker-hemmelighet i x-worker-secret, konstant-tid-sammenligning
//   - hemmeligheten kontrolleres FØR enhver databasekontakt
//   - saniterte svar og logger: aldri LinkedIn-innhold, kun tellere og feilkoder
//
// Ruten skriver aldri til produktdata; kun linkedin_*-tabellene berøres.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LINKEDIN_PURPOSES } from "@/lib/linkedin/contract";

type ErrorCode =
  | "method_not_allowed"
  | "unauthorized"
  | "server_misconfigured"
  | "invalid_request"
  | "import_not_found"
  | "database_error";

function fail(status: number, code: ErrorCode) {
  return Response.json({ ok: false, error: { code } }, { status });
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const bodySchema = z.object({
  import_id: z.string().uuid(),
  archive_base64: z.string().min(1),
  purposes: z.array(z.enum(LINKEDIN_PURPOSES)).min(1),
});

export const Route = createFileRoute("/api/internal/linkedin-import-worker")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed"),
      POST: async ({ request }) => {
        // --- 1. intern autorisasjon før alt annet ------------------------
        const expected = process.env["LINKEDIN_IMPORT_WORKER_SECRET"];
        if (!expected) return fail(500, "server_misconfigured");
        if (!secretMatches(request.headers.get("x-worker-secret"), expected)) {
          return fail(401, "unauthorized");
        }

        let parsedBody: z.infer<typeof bodySchema>;
        try {
          parsedBody = bodySchema.parse(await request.json());
        } catch {
          return fail(400, "invalid_request");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: importRow, error: importError } = await supabaseAdmin
          .from("linkedin_imports")
          .select("id, user_id, status, purged_at")
          .eq("id", parsedBody.import_id)
          .maybeSingle();
        if (importError) return fail(500, "database_error");
        if (!importRow || importRow.purged_at) return fail(404, "import_not_found");

        const attemptId = crypto.randomUUID();
        await supabaseAdmin
          .from("linkedin_imports")
          .update({
            active_phase: "validation",
            attempt_id: attemptId,
            heartbeat_at: new Date().toISOString(),
            staging_started_at: new Date().toISOString(),
          })
          .eq("id", importRow.id);

        try {
          const archive = Uint8Array.from(atob(parsedBody.archive_base64), (c) => c.charCodeAt(0));
          const { validateAndStageArchive } = await import("@/lib/linkedin/stage.server");

          const outcome = await validateAndStageArchive({
            admin: supabaseAdmin as never,
            userId: importRow.user_id as string,
            importId: importRow.id as string,
            attemptId,
            archive,
            selectedPurposes: parsedBody.purposes,
          });

          await supabaseAdmin
            .from("linkedin_imports")
            .update({
              status: outcome.ok ? "reconciliation_ready" : outcome.status,
              error_code: outcome.errorCode ?? null,
              active_phase: null,
              heartbeat_at: null,
              content_manifest_hash: outcome.contentManifestHash || null,
              known_file_count: outcome.knownFileCount,
              unknown_file_count: outcome.unknownFileCount,
              excluded_file_count: outcome.excludedFileCount,
              valid_file_count: outcome.validFileCount,
              invalid_file_count: outcome.invalidFileCount,
              staged_record_count: outcome.stagedRecordCount,
              excluded_reason_counts: outcome.excludedReasonCounts,
              validated_at: new Date().toISOString(),
              staged_at: outcome.ok ? new Date().toISOString() : null,
            })
            .eq("id", importRow.id);

          return Response.json({
            ok: outcome.ok,
            import_id: importRow.id,
            attempt_id: attemptId,
            status: outcome.status,
            error_code: outcome.errorCode ?? null,
            counts: {
              known: outcome.knownFileCount,
              unknown: outcome.unknownFileCount,
              excluded: outcome.excludedFileCount,
              valid: outcome.validFileCount,
              invalid: outcome.invalidFileCount,
              staged_records: outcome.stagedRecordCount,
            },
          });
        } catch (error) {
          console.error(
            "[linkedin-import-worker] staging failed",
            error instanceof Error ? error.name : "unknown",
          );
          await supabaseAdmin
            .from("linkedin_imports")
            .update({ status: "failed", error_code: "worker_error", active_phase: null, heartbeat_at: null })
            .eq("id", importRow.id);
          return fail(500, "database_error");
        }
      },
    },
  },
});
